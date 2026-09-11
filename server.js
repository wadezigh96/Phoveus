/**
 * Phoveus backend proxy
 * ---------------------
 * This server has two jobs:
 *
 *  1. /api/agent-call   → receive a market snapshot from the frontend, ask Claude
 *                          for a trading call (symbol / call / confidence / reasoning),
 *                          fall back to a local heuristic if Claude is unavailable.
 *
 *  2. /api/place-order  → receive an order that the user has ALREADY approved in the UI,
 *                          then forward it to the Binance Agent OS MCP server via the
 *                          `place_order` tool.
 *
 * SECURITY PRINCIPLES:
 *  - Claude API keys and Binance Agent OS tokens live ONLY on this server
 *    (via the .env file). They are NEVER sent to the browser.
 *  - /api/place-order rejects any request that does not explicitly contain
 *    `confirmed: true` — human approval stays in the UI; this server only forwards.
 *  - CORS is restricted to ALLOWED_ORIGIN (no wildcard "*").
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const {
  PORT = 8787,
  ALLOWED_ORIGIN = "http://localhost:5500",
  ANTHROPIC_API_KEY = "",
  BINANCE_AGENT_OS_URL = "",
  BINANCE_AGENT_OS_TOKEN = "",
  ADMIN_DEBUG_KEY = "",
} = process.env;

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
  })
);

// Very simple in-memory rate limit per IP.
// For production traffic, replace with Redis / API gateway rate limiting.
const rateBuckets = new Map();
function simpleRateLimit(maxPerMinute = 20) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const windowMs = 60_000;
    const bucket = rateBuckets.get(key) ?? [];
    const recent = bucket.filter((t) => now - t < windowMs);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: "Too many requests, please try again shortly." });
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    next();
  };
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

// ---------------------------------------------------------------------------
// 1) /api/agent-call — reasoning (Claude + local heuristic fallback)
// ---------------------------------------------------------------------------

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function heuristicCall({ prices, changePct }) {
  let bestSym = SYMBOLS[0];
  let bestAbs = -1;
  for (const s of SYMBOLS) {
    const chg = changePct?.[s];
    if (typeof chg === "number" && Math.abs(chg) > bestAbs) {
      bestAbs = Math.abs(chg);
      bestSym = s;
    }
  }
  const chg = changePct?.[bestSym] ?? 0;
  let call = "neutral";
  if (chg > 0.3) call = "long";
  else if (chg < -0.3) call = "short";
  const confidence = Math.max(50, Math.min(90, 50 + Math.round(Math.abs(chg) * 20)));

  let reasoning;
  if (call === "long") {
    reasoning = `${bestSym} is up ${chg.toFixed(2)}% over the last 24h — short-term momentum looks positive.`;
  } else if (call === "short") {
    reasoning = `${bestSym} is down ${Math.abs(chg).toFixed(2)}% over the last 24h — selling pressure is still visible.`;
  } else {
    reasoning = `${bestSym} is relatively flat (${chg.toFixed(2)}% over 24h) — no strong directional signal yet.`;
  }
  return { symbol: bestSym, call, confidence, reasoning };
}

function isValidCall(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    SYMBOLS.includes(obj.symbol) &&
    ["long", "short", "neutral"].includes(obj.call) &&
    typeof obj.confidence === "number" &&
    typeof obj.reasoning === "string"
  );
}

app.post("/api/agent-call", simpleRateLimit(20), async (req, res) => {
  const { symbols, prices, changePct } = req.body ?? {};
  if (!Array.isArray(symbols) || !prices || !changePct) {
    return res.status(400).json({ error: "Body must contain symbols, prices, and changePct." });
  }

  if (!anthropic) {
    return res.json(heuristicCall({ prices, changePct }));
  }

  try {
    const marketSummary = SYMBOLS.map((s) => `${s}: $${prices[s] ?? "—"} (${changePct[s]?.toFixed?.(2) ?? "—"}% / 24h)`).join(", ");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are a trading agent for Phoveus, a simulated prediction market connected to Binance Agent OS.
Current market prices: ${marketSummary}.
Pick ONE symbol from ${SYMBOLS.join(", ")} and issue a short-term trading call.
Reply ONLY with raw JSON (no markdown), exactly in this format:
{"symbol":"BTCUSDT","call":"long|short|neutral","confidence":0-100,"reasoning":"1-2 short sentences in English"}`,
        },
      ],
    });

    const textBlock = response.content?.find((b) => b.type === "text");
    const clean = textBlock?.text?.replace(/```json|```/g, "").trim();
    const parsed = clean ? JSON.parse(clean) : null;

    if (isValidCall(parsed)) {
      parsed.confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence)));
      parsed.reasoning = parsed.reasoning.slice(0, 400);
      return res.json(parsed);
    }
    throw new Error("Claude response did not match the expected format.");
  } catch (err) {
    console.error("[/api/agent-call] Claude failed, falling back to heuristic:", err.message);
    return res.json(heuristicCall({ prices, changePct }));
  }
});

// ---------------------------------------------------------------------------
// 2) MCP client — connection to Binance Agent OS
// ---------------------------------------------------------------------------

let mcpClientPromise = null;

function getMcpClient() {
  if (!BINANCE_AGENT_OS_URL || !BINANCE_AGENT_OS_TOKEN) {
    throw new Error(
      "BINANCE_AGENT_OS_URL / BINANCE_AGENT_OS_TOKEN are not set in .env — order execution is unavailable."
    );
  }
  if (!mcpClientPromise) {
    mcpClientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(BINANCE_AGENT_OS_URL), {
        requestInit: {
          headers: { Authorization: `Bearer ${BINANCE_AGENT_OS_TOKEN}` },
        },
      });
      const client = new Client({ name: "phoveus-agent", version: "0.1.0" });
      await client.connect(transport);
      return client;
    })().catch((err) => {
      // Reset so the next attempt can retry instead of staying stuck on the old error
      mcpClientPromise = null;
      throw err;
    });
  }
  return mcpClientPromise;
}

// Debug endpoint: list the tools actually exposed by the MCP server.
// (Tool names & schemas may differ from assumptions — always check this first.)
app.get("/api/tools", async (req, res) => {
  if (!ADMIN_DEBUG_KEY || req.query.key !== ADMIN_DEBUG_KEY) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const client = await getMcpClient();
    const tools = await client.listTools();
    res.json(tools);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3) /api/place-order — real order execution, only after user approval
// ---------------------------------------------------------------------------

app.post("/api/place-order", simpleRateLimit(10), async (req, res) => {
  const { symbol, side, quantity, orderType = "MARKET", confirmed } = req.body ?? {};

  if (confirmed !== true) {
    return res.status(400).json({
      error: "Order rejected: field 'confirmed' must be true. Explicit user approval in the UI is required before calling this endpoint.",
    });
  }
  if (!SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: `Unknown symbol: ${symbol}` });
  }
  if (!["BUY", "SELL"].includes(side)) {
    return res.status(400).json({ error: "side must be 'BUY' or 'SELL'." });
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ error: "quantity must be a positive number." });
  }

  try {
    const client = await getMcpClient();

    // NOTE: tool name and argument shape below are ASSUMPTIONS based on common
    // MCP trading-server patterns. Before going live, call GET /api/tools and
    // adjust this section to match the real schema returned by Binance Agent OS.
    const result = await client.callTool({
      name: "place_order",
      arguments: { symbol, side, quantity, type: orderType },
    });

    console.log("[/api/place-order] order sent:", { symbol, side, quantity, orderType });
    res.json({ ok: true, result });
  } catch (err) {
    console.error("[/api/place-order] failed:", err.message);
    res.status(502).json({ error: `Failed to reach Binance Agent OS MCP: ${err.message}` });
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Phoveus backend proxy running at http://localhost:${PORT}`);
  console.log(`Allowed CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`Claude reasoning: ${anthropic ? "enabled" : "disabled (using heuristic fallback)"}`);
  console.log(`Binance Agent OS MCP: ${BINANCE_AGENT_OS_URL && BINANCE_AGENT_OS_TOKEN ? "configured" : "not configured"}`);
});

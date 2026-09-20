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
import crypto from "node:crypto";
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
  BINANCE_WEB3_API_KEY = "",
  BINANCE_WEB3_API_SECRET = "",
  BINANCE_WEB3_BASE_URL = "https://web3.binance.com/build",
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
// 2) Binance Web3 RWA API — signed read-only tokenized-stock data
// ---------------------------------------------------------------------------

function buildBinanceWeb3Signature({ timestamp, method, requestPath, body = "" }) {
  const preHash = timestamp + method.toUpperCase() + requestPath + body;
  return crypto
    .createHmac("sha256", BINANCE_WEB3_API_SECRET)
    .update(preHash)
    .digest("base64");
}

async function binanceWeb3Request(path, query = {}) {
  if (!BINANCE_WEB3_API_KEY || !BINANCE_WEB3_API_SECRET) {
    throw new Error("BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET are not configured.");
  }

  const url = new URL(path, BINANCE_WEB3_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const requestPath = url.pathname + (url.search ? url.search : "");
  const timestamp = new Date().toISOString();
  const sign = buildBinanceWeb3Signature({
    timestamp,
    method: "GET",
    requestPath,
    body: "",
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-OC-APIKEY": BINANCE_WEB3_API_KEY,
      "X-OC-SIGN": sign,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-RECV-WINDOW": "5000",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({
    code: -1,
    msg: "Binance Web3 API returned a non-JSON response.",
  }));

  if (!response.ok) {
    const err = new Error(payload?.msg || `Binance Web3 HTTP ${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

const RWA_FALLBACK_ASSETS = [
  { symbol: "NVDA", name: "NVIDIA Corp.", platformId: "bstock", chainId: "56", assetType: "Tokenized Stock", referencePrice: null },
  { symbol: "TSLA", name: "Tesla Inc.", platformId: "bstock", chainId: "56", assetType: "Tokenized Stock", referencePrice: null },
  { symbol: "AAPL", name: "Apple Inc.", platformId: "bstock", chainId: "56", assetType: "Tokenized Stock", referencePrice: null },
  { symbol: "MSFT", name: "Microsoft Corp.", platformId: "bstock", chainId: "56", assetType: "Tokenized Stock", referencePrice: null },
];

function rwaFallback(keyword = "") {
  const q = String(keyword).trim().toUpperCase();
  const matches = RWA_FALLBACK_ASSETS.filter((asset) =>
    !q || asset.symbol.includes(q) || asset.name.toUpperCase().includes(q)
  );
  return {
    ok: true,
    source: "fallback-demo",
    degraded: true,
    message: "Binance Web3 RWA data is temporarily unavailable in this deployment environment. Showing a clearly labeled demo catalog; no live price is claimed.",
    items: matches.length ? matches : RWA_FALLBACK_ASSETS,
  };
}

function isBinanceRestrictedError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const upstream = String(err?.payload?.msg || "").toLowerCase();
  return msg.includes("restricted location") ||
    upstream.includes("restricted location") ||
    err?.payload?.code === 0;
}

function requireRwaConfig(res) {
  if (!BINANCE_WEB3_API_KEY || !BINANCE_WEB3_API_SECRET) {
    res.status(503).json({
      error: "Binance Web3 RWA API is not configured.",
      hint: "Set BINANCE_WEB3_API_KEY and BINANCE_WEB3_API_SECRET in the server environment.",
    });
    return false;
  }
  return true;
}

// Search tokenized stocks by ticker/company/contract address.
// Example: GET /api/rwa/search?keyword=NVDA&platformId=bstock
app.get("/api/rwa/search", simpleRateLimit(30), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const keyword = String(req.query.keyword || "").trim();
  const platformId = String(req.query.platformId || "").trim();

  if (!keyword || keyword.length > 80) {
    return res.status(400).json({ error: "keyword is required and must be <= 80 characters." });
  }
  if (platformId && !["ondo", "bstock"].includes(platformId)) {
    return res.status(400).json({ error: "platformId must be 'ondo' or 'bstock'." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/market/rwa/search", {
      keyword,
      ...(platformId ? { platformId } : {}),
    });
    return res.json(data);
  } catch (err) {
    console.error("[/api/rwa/search] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.json(rwaFallback(keyword));
    }
    return res.status(err.status || 502).json({
      ok: false,
      source: "binance",
      error: "Tokenized-stock data is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// Batch tokenized-stock price: on-chain token price + underlying reference price.
// Example: GET /api/rwa/price?binanceChainId=56&tokenContractAddresses=0x...
app.get("/api/rwa/price", simpleRateLimit(30), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.query.binanceChainId || "56").trim();
  const tokenContractAddresses = String(req.query.tokenContractAddresses || "").trim();

  if (!tokenContractAddresses) {
    return res.status(400).json({ error: "tokenContractAddresses is required." });
  }

  const addresses = tokenContractAddresses.split(",").map((x) => x.trim()).filter(Boolean);
  if (addresses.length === 0 || addresses.length > 100) {
    return res.status(400).json({ error: "Provide 1-100 token contract addresses." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/market/rwa/price", {
      binanceChainId,
      tokenContractAddresses: addresses.join(","),
    });
    return res.json(data);
  } catch (err) {
    console.error("[/api/rwa/price] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.json({
        ok: true,
        source: "fallback-demo",
        degraded: true,
        message: "Live Binance RWA price data is unavailable in this deployment environment.",
        items: [],
      });
    }
    return res.status(err.status || 502).json({
      ok: false,
      source: "binance",
      error: "Tokenized-stock price data is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// Tokenized-stock list with market status, token price, reference price, volume and metadata.
// Example: GET /api/rwa/tokens?binanceChainId=56&platformId=bstock
app.get("/api/rwa/tokens", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.query.binanceChainId || "").trim();
  const platformId = String(req.query.platformId || "").trim();
  const tabId = String(req.query.tabId || "").trim();

  if (platformId && !["ondo", "bstock"].includes(platformId)) {
    return res.status(400).json({ error: "platformId must be 'ondo' or 'bstock'." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/market/rwa/tokens", {
      ...(binanceChainId ? { binanceChainId } : {}),
      ...(platformId ? { platformId } : {}),
      ...(tabId ? { tabId } : {}),
    });
    return res.json(data);
  } catch (err) {
    console.error("[/api/rwa/tokens] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.json(rwaFallback(""));
    }
    return res.status(err.status || 502).json({
      ok: false,
      source: "binance",
      error: "Tokenized-stock catalog is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// Underlying market data for one tokenized stock.
// Example: GET /api/rwa/underlying-market?binanceChainId=56&tokenContractAddress=0x...
app.get("/api/rwa/underlying-market", simpleRateLimit(30), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.query.binanceChainId || "56").trim();
  const tokenContractAddress = String(req.query.tokenContractAddress || "").trim();

  if (!tokenContractAddress) {
    return res.status(400).json({ error: "tokenContractAddress is required." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/market/rwa/underlying-market", {
      binanceChainId,
      tokenContractAddress,
    });
    return res.json(data);
  } catch (err) {
    console.error("[/api/rwa/underlying-market] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.json({
        ok: true,
        source: "fallback-demo",
        degraded: true,
        message: "Live underlying-market data is unavailable in this deployment environment.",
        items: [],
      });
    }
    return res.status(err.status || 502).json({
      ok: false,
      source: "binance",
      error: "Underlying market data is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// 3) Phoveus Market-Clock Intelligence — RWA market-state engine
// ---------------------------------------------------------------------------

function classifyRwaMarketState({ openState, marketStatus, nextOpenTime, divergencePct }) {
  const now = Date.now();
  const nextOpen = Number(nextOpenTime || 0);
  const minutesToOpen = nextOpen > now ? (nextOpen - now) / 60000 : null;

  if (openState === true || marketStatus === "regular") {
    return { state: "OPEN", reason: "Underlying market is open." };
  }
  if (minutesToOpen !== null && minutesToOpen <= 60) {
    return { state: "REOPENING", reason: "Underlying market is scheduled to reopen within 60 minutes." };
  }
  if (typeof divergencePct === "number" && Math.abs(divergencePct) >= 1) {
    return { state: "REFERENCE_LAG", reason: "Underlying market is closed and the on-chain/reference prices are diverging." };
  }
  return { state: "CLOSED", reason: "Underlying market is closed." };
}

function buildRwaIntelligenceFallback(symbol) {
  return {
    ok: true,
    source: "fallback-demo",
    degraded: true,
    asset: { symbol: symbol || "NVDA", name: symbol === "NVDA" ? "NVIDIA Corp." : "Tokenized stock" },
    intelligence: {
      state: "DATA_RESTRICTED",
      reason: "Live RWA market intelligence is unavailable in this deployment environment.",
      executionLocked: true,
      divergencePct: null,
      tokenPrice: null,
      referencePrice: null,
      snapshotAgeSeconds: null,
      nextOpenTime: null,
    },
  };
}

app.get("/api/rwa/intelligence", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const symbol = String(req.query.symbol || "NVDA").trim().toUpperCase();
  const platformId = String(req.query.platformId || "bstock").trim();

  if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: "Invalid symbol." });
  }
  if (!["ondo", "bstock"].includes(platformId)) {
    return res.status(400).json({ error: "platformId must be 'ondo' or 'bstock'." });
  }

  try {
    const search = await binanceWeb3Request("/api/v1/dex/market/rwa/search", { keyword: symbol, platformId });
    const ticker = Array.isArray(search?.data) ? search.data.find((x) => String(x?.ticker || "").toUpperCase() === symbol) : search?.data?.[0];
    const asset = ticker?.assets?.find((x) => String(x?.binanceChainId) === "56") || ticker?.assets?.[0];

    if (!asset?.tokenContractAddress) {
      return res.json({
        ok: true,
        source: "binance",
        intelligence: { state: "NO_ASSET", reason: "No supported BNB Chain tokenized asset was found." },
      });
    }

    const chainId = String(asset.binanceChainId || "56");
    const address = asset.tokenContractAddress;

    const [priceResult, marketResult] = await Promise.all([
      binanceWeb3Request("/api/v1/dex/market/rwa/price", {
        binanceChainId: chainId,
        tokenContractAddresses: address,
      }),
      binanceWeb3Request("/api/v1/dex/market/rwa/underlying-market", {
        binanceChainId: chainId,
        tokenContractAddress: address,
      }),
    ]);

    const price = Array.isArray(priceResult?.data) ? priceResult.data[0] : null;
    const market = marketResult?.data || {};
    const status = market.statusInfo || {};
    const tokenPrice = Number(price?.tokenPrice);
    const referencePrice = Number(price?.referencePrice);
    const divergencePct = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice !== 0
      ? ((tokenPrice - referencePrice) / referencePrice) * 100
      : null;
    const snapshotMs = Number(marketResult?.timestamp || priceResult?.timestamp || 0);
    const snapshotAgeSeconds = snapshotMs ? Math.max(0, Math.round((Date.now() - snapshotMs) / 1000)) : null;
    const classification = classifyRwaMarketState({
      openState: status.openState,
      marketStatus: status.marketStatus,
      nextOpenTime: status.nextOpenTime,
      divergencePct,
    });

    const executionLocked =
      classification.state === "REOPENING" ||
      classification.state === "REFERENCE_LAG" ||
      classification.state === "DATA_RESTRICTED";

    return res.json({
      ok: true,
      source: "binance",
      asset: {
        symbol: ticker?.ticker || symbol,
        name: ticker?.companyName || "Tokenized stock",
        platformId: asset.platformId,
        chainId,
        tokenContractAddress: address,
        tokenSymbol: asset.tokenSymbol || null,
      },
      intelligence: {
        state: classification.state,
        reason: classification.reason,
        executionLocked,
        marketStatus: status.marketStatus || null,
        openState: status.openState ?? null,
        nextOpenTime: status.nextOpenTime || null,
        nextCloseTime: status.nextCloseTime || null,
        tokenPrice: Number.isFinite(tokenPrice) ? tokenPrice : null,
        referencePrice: Number.isFinite(referencePrice) ? referencePrice : null,
        divergencePct: Number.isFinite(divergencePct) ? Number(divergencePct.toFixed(4)) : null,
        tokenPriceUpdatedAt: price?.tokenPriceUpdatedAt || null,
        snapshotAgeSeconds,
      },
    });
  } catch (err) {
    console.error("[/api/rwa/intelligence] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) return res.json(buildRwaIntelligenceFallback(symbol));
    return res.status(err.status || 502).json({
      ok: false,
      source: "binance",
      error: "Market-clock intelligence is temporarily unavailable.",
    });
  }
}

// ---------------------------------------------------------------------------
// 3) MCP client — connection to Binance Agent OS
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
// 4) /api/place-order — real order execution, only after user approval
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

app.get("/healthz", (req, res) => res.json({
  ok: true,
  binanceWeb3Rwa: Boolean(BINANCE_WEB3_API_KEY && BINANCE_WEB3_API_SECRET),
  rwaFallback: true,
}));

app.listen(PORT, () => {
  console.log(`Phoveus backend proxy running at http://localhost:${PORT}`);
  console.log(`Allowed CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`Claude reasoning: ${anthropic ? "enabled" : "disabled (using heuristic fallback)"}`);
  console.log(`Binance Web3 RWA API: ${BINANCE_WEB3_API_KEY && BINANCE_WEB3_API_SECRET ? "configured" : "not configured"}`);
  console.log(`Binance Agent OS MCP: ${BINANCE_AGENT_OS_URL && BINANCE_AGENT_OS_TOKEN ? "configured" : "not configured"}`);
});

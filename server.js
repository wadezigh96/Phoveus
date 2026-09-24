/**
 * Phoveus backend proxy
 * ---------------------
 * This server has two jobs:
 *
 *  1. /api/agent-call   → receive a market snapshot from the frontend, ask Claude
 *                          for a trading call (symbol / call / confidence / reasoning),
 *                          fall back to a local heuristic if Claude is unavailable.
 *
 *  2. /api/place-order  → validate an explicitly approved request, verify the discovered
 *                          MCP order schema, and remain fail-closed until that schema is
 *                          explicitly mapped. No guessed order is forwarded.
 *
 * SECURITY PRINCIPLES:
 *  - Claude API keys and Binance Agent OS tokens live ONLY on this server
 *    (via the .env file). They are NEVER sent to the browser.
 *  - /api/place-order rejects unapproved requests and never guesses an MCP schema.
 *  - Live order execution remains disabled until the exact runtime schema is verified.
 *  - CORS is restricted to ALLOWED_ORIGIN (no wildcard "*").
 */

import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  BINANCE_AGENT_OS_URL as BINANCE_AGENT_OS_OAUTH_URL,
  getAgentOsProvider,
  beginAgentOsAuth,
  finishAgentOsAuth,
  requireAgentOsProvider,
  isAgentOsAuthorized,
  clearAgentOsSession,
} from "./agent-os-oauth.js";

const {
  PORT = 8787,
  ALLOWED_ORIGIN = "http://localhost:5500",
  ANTHROPIC_API_KEY = "",
  BINANCE_AGENT_OS_URL = BINANCE_AGENT_OS_OAUTH_URL,
  BINANCE_WEB3_API_KEY = "",
  BINANCE_WEB3_API_SECRET = "",
  BINANCE_WEB3_BASE_URL = "https://web3.binance.com/build",
  ADMIN_DEBUG_KEY = "",
} = process.env;

const app = express();
const APP_HTML = path.join(process.cwd(), "phoveus-agent-os.html");
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

app.post("/api/rwa/agent-call", simpleRateLimit(20), async (req, res) => {
  const symbol = String(req.body?.symbol || "NVDA").trim().toUpperCase();
  const platformId = String(req.body?.platformId || "bstock").trim();

  try {
    const upstream = await fetch(new URL(`/api/rwa/intelligence?symbol=${encodeURIComponent(symbol)}&platformId=${encodeURIComponent(platformId)}`, `http://127.0.0.1:${PORT}`), {
      headers: { accept: "application/json" },
    });
    const data = await upstream.json();
    const intelligence = data?.intelligence || {};
    const locked = Boolean(intelligence.executionLocked);

    if (locked) {
      return res.json({
        ok: true,
        agent: "Phoveus",
        decision: "WAIT",
        executionLocked: true,
        rationale: "Market-clock risk guard is active; no execution proposal is generated.",
        intelligence,
      });
    }

    if (!anthropic) {
      return res.json({
        ok: true,
        agent: "Phoveus",
        decision: "REVIEW",
        executionLocked: false,
        rationale: "RWA intelligence is available. Human review is required before any action.",
        intelligence,
        source: "deterministic-fallback",
      });
    }

    const prompt = [
      "You are Phoveus, a tokenized-stock market-clock intelligence agent.",
      "Use ONLY the supplied RWA intelligence. Do not invent prices, timestamps, market status, or liquidity.",
      "Do not place or authorize trades. Return REVIEW or WAIT only.",
      JSON.stringify({ symbol, platformId, intelligence }),
      'Return raw JSON: {"decision":"WAIT|REVIEW","rationale":"short factual explanation"}'
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content?.find((b) => b.type === "text");
    const clean = block?.text?.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const parsed = clean ? JSON.parse(clean) : null;
    const decision = parsed?.decision === "WAIT" ? "WAIT" : "REVIEW";

    return res.json({
      ok: true,
      agent: "Phoveus",
      decision,
      executionLocked: false,
      rationale: String(parsed?.rationale || "Human review is required before any action.").slice(0, 500),
      intelligence,
      source: "claude",
    });
  } catch (err) {
    console.error("[/api/rwa/agent-call] failed:", err.message);
    return res.status(502).json({
      ok: false,
      agent: "Phoveus",
      decision: "WAIT",
      executionLocked: true,
      error: "RWA agent reasoning is temporarily unavailable; execution remains locked.",
    });
  }
});

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
// 1.5) Phoveus agent capability registry
// ---------------------------------------------------------------------------

const PHOVEUS_SKILLS = [
  {
    id: "phoveus-rwa-research",
    name: "RWA Research",
    role: "Structures tokenized-stock context from Binance Web3 RWA data.",
  },
  {
    id: "phoveus-market-clock",
    name: "Market Clock",
    role: "Tracks on-chain/reference clocks, market state, and reference age.",
  },
  {
    id: "phoveus-risk-guard",
    name: "Reopening Risk Guard",
    role: "Fails closed during reopening, reference-lag, or restricted-data states.",
  },
  {
    id: "phoveus-execution-approval",
    name: "Execution Approval",
    role: "Requires explicit human approval before an order can reach MCP execution.",
  },
];

app.get("/api/agent/capabilities", (req, res) => {
  const skills = [
    ...PHOVEUS_SKILLS,
    { id: "binance-tokenized-securities-info", name: "Tokenized Securities Discovery", role: "Resolves supported tokenized-stock representations and providers." },
    { id: "binance-query-token-info", name: "Token Identity", role: "Resolves token, contract, and chain identity before on-chain actions." },
    { id: "binance-query-token-audit", name: "Token Audit", role: "Adds an asset-security/context check before execution." },
    { id: "binance-agentic-wallet", name: "Agentic Wallet", role: "Provides a controlled wallet-action adapter behind Phoveus risk and approval gates." },
  ];
  res.json({
    ok: true,
    agent: "Phoveus",
    specialization: "Tokenized-stock market-clock intelligence",
    skills,
    skillPipeline: [
      "tokenized-securities-discovery",
      "token-identity",
      "token-audit",
      "rwa-research",
      "market-clock",
      "risk-guard",
      "agent-reasoning",
      "human-approval",
      "agentic-wallet-or-agent-os",
    ],
    executionPolicy: {
      automaticTrading: false,
      humanApprovalRequired: true,
      guardedStates: ["REOPENING", "REFERENCE_LAG", "DATA_RESTRICTED"],
    },
    integrations: {
      binanceWeb3Rwa: Boolean(BINANCE_WEB3_API_KEY && BINANCE_WEB3_API_SECRET),
      binanceAgentOsConfigured: Boolean(BINANCE_AGENT_OS_URL && (process.env.PHOVEUS_SESSION_SECRET || process.env.ADMIN_DEBUG_KEY)),
    },
  });
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

  // Binance Web3 can return HTTP 200 while reporting a business error in JSON.
  if (!response.ok || (payload && payload.code !== undefined && payload.code !== 0)) {
    const err = new Error(payload?.msg || `Binance Web3 HTTP ${response.status}`);
    err.status = response.status || 502;
    err.payload = payload;
    throw err;
  }

  return payload;
}

async function binanceWeb3Post(path, body) {
  if (!BINANCE_WEB3_API_KEY || !BINANCE_WEB3_API_SECRET) {
    throw new Error("BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET are not configured.");
  }

  const url = new URL(path, BINANCE_WEB3_BASE_URL);
  const requestPath = url.pathname;
  const requestBody = JSON.stringify(body ?? {});
  const timestamp = new Date().toISOString();
  const sign = buildBinanceWeb3Signature({
    timestamp,
    method: "POST",
    requestPath,
    body: requestBody,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OC-APIKEY": BINANCE_WEB3_API_KEY,
      "X-OC-SIGN": sign,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-RECV-WINDOW": "5000",
      Accept: "application/json",
    },
    body: requestBody,
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({
    code: -1,
    msg: "Binance Web3 API returned a non-JSON response.",
  }));

  if (!response.ok || payload?.code !== 0) {
    const err = new Error(payload?.msg || `Binance Web3 HTTP ${response.status}`);
    err.status = response.status || 502;
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
    err?.payload?.code === 40301 ||
    err?.payload?.code === 40302 ||
    err?.payload?.code === 40303;
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

// Wallet balance — signed read-only BSC balance check.
// Official Binance endpoint: GET /api/v1/dex/balance/all-token-balances-by-address
app.get("/api/wallet/balance", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const address = String(req.query.address || "").trim();
  const chains = String(req.query.chains || "56").trim();
  const evmAddress = /^0x[a-fA-F0-9]{40}$/;

  if (!evmAddress.test(address)) {
    return res.status(400).json({ ok: false, error: "address must be a valid EVM wallet address." });
  }
  if (chains !== "56") {
    return res.status(400).json({ ok: false, error: "Phoveus balance check currently supports BSC chain ID 56 only." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/balance/all-token-balances-by-address", {
      address,
      chains,
      excludeRiskToken: "true",
      page: "1",
      pageSize: "100",
    });
    return res.json({
      ok: true,
      phase: "balance-check",
      source: "binance",
      chainId: "56",
      address,
      data: data?.data || [],
      timestamp: data?.timestamp || null,
    });
  } catch (err) {
    console.error("[/api/wallet/balance] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.status(403).json({
        ok: false,
        phase: "balance-check",
        source: "binance",
        error: "Binance Web3 Wallet API is unavailable in this deployment environment because of a restricted-location response.",
        executionVerified: false,
      });
    }
    return res.status(err.status || 502).json({
      ok: false,
      phase: "balance-check",
      source: "binance",
      error: "Wallet balance is temporarily unavailable.",
      diagnostic: {
        httpStatus: Number(err?.status || 502),
        binanceCode: err?.payload?.code ?? null,
        binanceMessage: typeof err?.payload?.msg === "string" ? err.payload.msg.slice(0, 300) : null,
      },
    });
  }
});

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
// 2.5) Binance Web3 Trading API — quote only (Phase 1)
// ---------------------------------------------------------------------------
// Phase 1 deliberately stops at quote generation. No transaction is signed,
// broadcast, or executed here. The browser wallet will remain the signer in
// later phases.
//
// Official Binance Web3 quote endpoint:
// GET /api/v1/dex/aggregator/quote
// BSC chainId: 56
app.get("/api/trade/quote", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.query.binanceChainId || "56").trim();
  const amount = String(req.query.amount || "").trim();
  const fromTokenAddress = String(req.query.fromTokenAddress || "").trim();
  const toTokenAddress = String(req.query.toTokenAddress || "").trim();
  const userWalletAddress = String(req.query.userWalletAddress || "").trim();

  const evmAddress = /^0x[a-fA-F0-9]{40}$/;
  const positiveInteger = /^[1-9][0-9]*$/;

  if (binanceChainId !== "56") {
    return res.status(400).json({ error: "Phoveus trading demo currently supports BSC chain ID 56 only." });
  }
  if (!positiveInteger.test(amount)) {
    return res.status(400).json({ error: "amount must be a positive integer string in the token's smallest unit." });
  }
  if (!evmAddress.test(fromTokenAddress) || !evmAddress.test(toTokenAddress)) {
    return res.status(400).json({ error: "fromTokenAddress and toTokenAddress must be valid EVM addresses." });
  }
  if (fromTokenAddress.toLowerCase() === toTokenAddress.toLowerCase()) {
    return res.status(400).json({ error: "fromTokenAddress and toTokenAddress must be different." });
  }
  if (!evmAddress.test(userWalletAddress)) {
    return res.status(400).json({ error: "userWalletAddress must be a valid EVM wallet address." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/aggregator/quote", {
      binanceChainId,
      amount,
      fromTokenAddress,
      toTokenAddress,
      userWalletAddress,
    });

    return res.json({
      ok: true,
      phase: "quote",
      source: "binance",
      chainId: "56",
      data: data?.data || [],
      timestamp: data?.timestamp || null,
    });
  } catch (err) {
    console.error("[/api/trade/quote] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.status(403).json({
        ok: false,
        phase: "quote",
        source: "binance",
        error: "Binance Web3 Trading API is unavailable in this deployment environment because of a restricted-location response.",
        executionVerified: false,
      });
    }
    return res.status(err.status || 502).json({
      ok: false,
      phase: "quote",
      source: "binance",
      error: "Trading quote is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// Build swap calldata from a fresh Binance quote. This endpoint only
// constructs transaction data; it does not sign or broadcast anything.
app.get("/api/trade/swap", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.query.binanceChainId || "56").trim();
  const amount = String(req.query.amount || "").trim();
  const fromTokenAddress = String(req.query.fromTokenAddress || "").trim();
  const toTokenAddress = String(req.query.toTokenAddress || "").trim();
  const userWalletAddress = String(req.query.userWalletAddress || "").trim();
  const quoteId = String(req.query.quoteId || "").trim();
  const slippagePercent = String(req.query.slippagePercent || "0.5").trim();

  const evmAddress = /^0x[a-fA-F0-9]{40}$/;
  const positiveInteger = /^[1-9][0-9]*$/;
  const validSlippage = /^(?:0|[0-9]+(?:\.[0-9]{1,2})?)$/;

  if (binanceChainId !== "56") {
    return res.status(400).json({ error: "Phoveus trading demo currently supports BSC chain ID 56 only." });
  }
  if (!positiveInteger.test(amount)) {
    return res.status(400).json({ error: "amount must be a positive integer string in the token's smallest unit." });
  }
  if (!evmAddress.test(fromTokenAddress) || !evmAddress.test(toTokenAddress)) {
    return res.status(400).json({ error: "fromTokenAddress and toTokenAddress must be valid EVM addresses." });
  }
  if (!evmAddress.test(userWalletAddress)) {
    return res.status(400).json({ error: "userWalletAddress must be a valid EVM wallet address." });
  }
  if (!quoteId || quoteId.length > 200) {
    return res.status(400).json({ error: "quoteId is required." });
  }
  if (!validSlippage.test(slippagePercent) || Number(slippagePercent) < 0 || Number(slippagePercent) > 50) {
    return res.status(400).json({ error: "slippagePercent must be between 0 and 50." });
  }

  try {
    const data = await binanceWeb3Request("/api/v1/dex/aggregator/swap", {
      binanceChainId,
      amount,
      fromTokenAddress,
      toTokenAddress,
      userWalletAddress,
      quoteId,
      slippagePercent,
      approveTransaction: "true",
    });

    return res.json({
      ok: true,
      phase: "build-swap",
      source: "binance",
      chainId: "56",
      executionVerified: false,
      transactionBuilt: true,
      data: data?.data || null,
      timestamp: data?.timestamp || null,
    });
  } catch (err) {
    console.error("[/api/trade/swap] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.status(403).json({
        ok: false,
        phase: "build-swap",
        source: "binance",
        error: "Binance Web3 Trading API is unavailable in this deployment environment because of a restricted-location response.",
        executionVerified: false,
      });
    }
    return res.status(err.status || 502).json({
      ok: false,
      phase: "build-swap",
      source: "binance",
      error: "Swap transaction build is temporarily unavailable.",
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 2.1 — Binance Transaction API gas estimation
// ---------------------------------------------------------------------------
app.post("/api/transaction/gas-limit", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.body?.binanceChainId || "56").trim();
  const rawTx = req.body?.evmTx;

  if (binanceChainId !== "56") {
    return res.status(400).json({ error: "Phoveus transaction tools currently support BSC chain ID 56 only." });
  }

  if (!rawTx || typeof rawTx !== "object" || Array.isArray(rawTx)) {
    return res.status(400).json({ error: "evmTx object is required." });
  }

  const from = String(rawTx.from || "").trim();
  const to = String(rawTx.to || "").trim();
  const value = String(rawTx.value ?? "0").trim();
  const data = String(rawTx.data ?? "0x").trim();

  const evmAddress = /^0x[a-fA-F0-9]{40}$/;
  const hexData = /^0x(?:[a-fA-F0-9]{2})*$/;
  const decimalOrHex = /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/;

  if (!evmAddress.test(from) || !evmAddress.test(to)) {
    return res.status(400).json({ error: "evmTx.from and evmTx.to must be valid EVM addresses." });
  }
  if (!decimalOrHex.test(value)) {
    return res.status(400).json({ error: "evmTx.value must be a decimal or hex integer string." });
  }
  if (!hexData.test(data)) {
    return res.status(400).json({ error: "evmTx.data must be valid hex calldata." });
  }

  try {
    const result = await binanceWeb3Post("/api/v1/dex/pre-transaction/gas-limit", {
      binanceChainId,
      evmTx: { from, to, value, data },
    });

    return res.json({
      ok: true,
      phase: "gas-limit",
      source: "binance",
      chainId: "56",
      executionVerified: false,
      broadcasted: false,
      data: result?.data || null,
      timestamp: result?.timestamp || null,
    });
  } catch (err) {
    console.error("[/api/transaction/gas-limit] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.status(403).json({
        ok: false,
        phase: "gas-limit",
        source: "binance",
        error: "Binance Web3 Transaction API is unavailable in this deployment environment because of a restricted-location response.",
        executionVerified: false,
        broadcasted: false,
      });
    }

    return res.status(err.status || 502).json({
      ok: false,
      phase: "gas-limit",
      source: "binance",
      error: "Gas-limit estimation is temporarily unavailable.",
      executionVerified: false,
      broadcasted: false,
      ...(err.payload ? { binance: err.payload } : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 2 — Binance Transaction API simulation
// ---------------------------------------------------------------------------
// This is an off-chain dry run. It never signs or broadcasts a transaction.
app.post("/api/transaction/simulate", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;

  const binanceChainId = String(req.body?.binanceChainId || "56").trim();
  const rawTx = req.body?.evmTx;

  if (binanceChainId !== "56") {
    return res.status(400).json({ error: "Phoveus transaction simulation currently supports BSC chain ID 56 only." });
  }

  if (!rawTx || typeof rawTx !== "object" || Array.isArray(rawTx)) {
    return res.status(400).json({ error: "evmTx object is required." });
  }

  const from = String(rawTx.from || "").trim();
  const to = String(rawTx.to || "").trim();
  const value = String(rawTx.value ?? "0").trim();
  const data = String(rawTx.data ?? "0x").trim();

  const evmAddress = /^0x[a-fA-F0-9]{40}$/;
  const hexData = /^0x(?:[a-fA-F0-9]{2})*$/;
  const decimalOrHex = /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/;

  if (!evmAddress.test(from) || !evmAddress.test(to)) {
    return res.status(400).json({ error: "evmTx.from and evmTx.to must be valid EVM addresses." });
  }
  if (!decimalOrHex.test(value)) {
    return res.status(400).json({ error: "evmTx.value must be a decimal or hex integer string." });
  }
  if (!hexData.test(data)) {
    return res.status(400).json({ error: "evmTx.data must be valid hex calldata." });
  }

  const evmTx = { from, to, value, data };

  try {
    const result = await binanceWeb3Post("/api/v1/dex/pre-transaction/simulate", {
      binanceChainId,
      evmTx,
    });

    return res.json({
      ok: true,
      phase: "simulation",
      source: "binance",
      chainId: "56",
      executionVerified: false,
      broadcasted: false,
      data: result?.data || null,
      timestamp: result?.timestamp || null,
    });
  } catch (err) {
    console.error("[/api/transaction/simulate] Binance Web3 failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.status(403).json({
        ok: false,
        phase: "simulation",
        source: "binance",
        error: "Binance Web3 Transaction API is unavailable in this deployment environment because of a restricted-location response.",
        executionVerified: false,
        broadcasted: false,
      });
    }

    return res.status(err.status || 502).json({
      ok: false,
      phase: "simulation",
      source: "binance",
      error: "Transaction simulation is temporarily unavailable.",
      executionVerified: false,
      broadcasted: false,
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
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 3) MCP client — Binance Agent OS OAuth + Streamable HTTP
// ---------------------------------------------------------------------------

let mcpClients = new Map();

function getMcpClient(req, res) {
  const provider = requireAgentOsProvider(req, res);
  const sessionCookie = String(req.headers.cookie || "").match(/phoveus_agent_session=([^;]+)/)?.[1] || "anonymous";
  const sessionKey = sessionCookie || "default";

  if (!mcpClients.has(sessionKey)) {
    mcpClients.set(sessionKey, (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(BINANCE_AGENT_OS_URL), {
        authProvider: provider,
      });
      const client = new Client({ name: "phoveus-agent", version: "0.2.0" });
      await client.connect(transport);
      return client;
    })().catch((err) => {
      mcpClients.delete(sessionKey);
      throw err;
    }));
  }

  return mcpClients.get(sessionKey);
}

// OAuth Client ID Metadata Document (CIMD).
// Binance Agent OS does not use Dynamic Client Registration; the metadata URL
// is used as the public client_id by the MCP authorization flow.
app.get("/api/agent-os/client-metadata", (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")).split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (!host) return res.status(500).json({ error: "Cannot determine public host." });
  const baseUrl = `${proto}://${host}`;
  return res.json({
    client_id: `${baseUrl}/api/agent-os/client-metadata`,
    client_name: "Phoveus Agent OS",
    client_uri: baseUrl,
    redirect_uris: [`${baseUrl}/api/agent-os/callback`],
    application_type: "web",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
});

// Start Binance's official browser authorization flow.
// Do NOT open the MCP endpoint directly in a normal browser.
app.get("/api/agent-os/connect", async (req, res) => {
  try {
    const result = await beginAgentOsAuth(req, res);
    if (result.authorized) return res.redirect("/?agent_os=connected");
    return res.redirect(result.authorizationUrl);
  } catch (err) {
    console.error("[/api/agent-os/connect] failed:", err.message);
    return res.status(502).json({
      ok: false,
      error: "Unable to start Binance Agent OS authorization.",
      detail: String(err.message || "unknown error").slice(0, 300),
    });
  }
});

app.get("/api/agent-os/callback", async (req, res) => {
  try {
    await finishAgentOsAuth(req, res, { code: req.query.code, state: req.query.state });
    return res.redirect("/?agent_os=connected");
  } catch (err) {
    console.error("[/api/agent-os/callback] failed:", err.message);
    return res.status(400).send(
      `<html><body style="font-family:system-ui;padding:40px">
        <h2>Phoveus Agent OS authorization failed</h2>
        <p>${String(err.message || "Authorization failed").replace(/[<>&]/g, "")}</p>
        <p><a href="/api/agent-os/connect">Try Binance Agent OS authorization again</a></p>
      </body></html>`
    );
  }
});

app.get("/api/agent-os/status", (req, res) => {
  try {
    res.json({
      ok: true,
      authorized: isAgentOsAuthorized(req, res),
      endpoint: BINANCE_AGENT_OS_URL,
      authMode: "OAuth authorization-code + PKCE",
      tokenManagedBy: "MCP SDK session",
    });
  } catch (err) {
    res.status(500).json({ ok: false, authorized: false, error: "Agent OS status unavailable." });
  }
});

app.post("/api/agent-os/disconnect", (req, res) => {
  try {
    clearAgentOsSession(req, res);
    res.json({ ok: true, authorized: false });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Unable to disconnect Agent OS session." });
  }
});

// Debug endpoint: list the tools actually exposed by the MCP server.
app.get("/api/tools", async (req, res) => {
  if (!ADMIN_DEBUG_KEY || req.query.key !== ADMIN_DEBUG_KEY) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const client = await getMcpClient(req, res);
    const listed = await client.listTools();
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    res.json({
      ok: true,
      count: tools.length,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || null,
      })),
    });
  } catch (err) {
    const status = err?.status || (String(err.message).includes("not authorized") ? 401 : 500);
    res.status(status).json({ error: "Unable to query Binance Agent OS MCP tools." });
  }
});

app.get("/api/agent/mcp-capabilities", async (req, res) => {
  if (!ADMIN_DEBUG_KEY || req.query.key !== ADMIN_DEBUG_KEY) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const client = await getMcpClient(req, res);
    const listed = await client.listTools();
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const names = tools.map((tool) => String(tool.name || ""));
    const executionCandidates = names.filter((name) => /order|trade|swap|execute/i.test(name));
    res.json({
      ok: true,
      connected: true,
      toolCount: tools.length,
      executionCandidates,
      mapping: {
        marketClock: "Phoveus local deterministic skill",
        riskGuard: "Phoveus local deterministic skill",
        executionApproval: "Phoveus local approval gate",
        mcpExecution: executionCandidates,
      },
      liveOrderSchemaVerified: executionCandidates.length > 0,
      note: executionCandidates.length
        ? "Execution-capable MCP tools were discovered from Binance Agent OS. Phoveus still requires explicit approval and schema validation before an order is sent."
        : "No execution-capable MCP tool was exposed for this authorized session.",
    });
  } catch (err) {
    const status = err?.status || (String(err.message).includes("not authorized") ? 401 : 502);
    res.status(status).json({
      ok: false,
      connected: false,
      error: "Binance Agent OS MCP capability discovery failed.",
    });
  }
});

// ---------------------------------------------------------------------------
// 4) /api/place-order — fail-closed execution gate
// ---------------------------------------------------------------------------

app.get("/api/rwa/decision", simpleRateLimit(20), async (req, res) => {
  if (!requireRwaConfig(res)) return;
  const symbol = String(req.query.symbol || "NVDA").trim().toUpperCase();
  const platformId = String(req.query.platformId || "bstock").trim();

  try {
    const upstream = await fetch(new URL(`/api/rwa/intelligence?symbol=${encodeURIComponent(symbol)}&platformId=${encodeURIComponent(platformId)}`, `http://127.0.0.1:${PORT}`), {
      headers: { accept: "application/json" },
    });
    const data = await upstream.json();
    const i = data?.intelligence || {};
    const locked = Boolean(i.executionLocked);
    const decision = locked ? "WAIT" : "REVIEW";
    const rationale = locked
      ? "Execution is locked because the market-clock engine detected a reopening/reference-lag risk state."
      : "No automatic execution decision is made. User approval is still required.";

    res.status(upstream.ok ? 200 : upstream.status).json({
      ok: true,
      source: data?.source || "binance",
      asset: data?.asset || { symbol, platformId },
      decision,
      executionLocked: locked,
      rationale,
      intelligence: i,
    });
  } catch (err) {
    console.error("[/api/rwa/decision] failed:", err.message);
    if (isBinanceRestrictedError(err)) {
      return res.json({
        ...buildRwaIntelligenceFallback(symbol),
        decision: "WAIT",
        executionLocked: true,
        rationale: "Live RWA intelligence is unavailable in this deployment environment; execution remains locked.",
      });
    }
    return res.status(502).json({ ok: false, error: "RWA agent decision is temporarily unavailable." });
  }
});

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
    const client = await getMcpClient(req, res);

    // Never guess the MCP tool name or argument schema.
    // Discovery must explicitly verify an order-capable tool before live execution.
    const listed = await client.listTools();
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const orderTool = tools.find((tool) => {
      const name = String(tool?.name || "").toLowerCase();
      return /^(place_order|create_order|submit_order)$/.test(name);
    });

    if (!orderTool) {
      return res.status(503).json({
        error: "No verified Binance Agent OS order tool is available. Live execution remains disabled.",
        executionVerified: false,
      });
    }

    const schema = orderTool.inputSchema;
    if (!schema || typeof schema !== "object") {
      return res.status(503).json({
        error: "Binance Agent OS order tool has no usable input schema. Live execution remains disabled.",
        executionVerified: false,
      });
    }

    // The generic legacy mapping is intentionally disabled until the exact
    // discovered schema is explicitly compatible with Phoveus' approval contract.
    return res.status(503).json({
      error: "Order tool discovered, but its schema has not been explicitly mapped to Phoveus. No order was sent.",
      executionVerified: false,
      discoveredTool: orderTool.name,
      requiredApproval: true,
    });
  } catch (err) {
    console.error("[/api/place-order] failed:", err.message);
    res.status(502).json({ error: `Failed to reach Binance Agent OS MCP: ${err.message}` });
  }
});

app.get("/healthz", async (req, res) => {
  const agentOsConfigured = Boolean(BINANCE_AGENT_OS_URL && (process.env.PHOVEUS_SESSION_SECRET || process.env.ADMIN_DEBUG_KEY));
  let agentOs = {
    configured: agentOsConfigured,
    connected: false,
    toolsAvailable: null,
  };

  // Health checks never expose the MCP token or tool arguments.
  if (agentOsConfigured) {
    try {
      if (isAgentOsAuthorized(req, res)) {
        const client = await getMcpClient(req, res);
        const listed = await client.listTools();
        agentOs.connected = true;
        agentOs.toolsAvailable = Array.isArray(listed?.tools) ? listed.tools.length : 0;
      }
    } catch (err) {
      agentOs.error = "MCP connection check failed";
    }
  }

  res.json({
    ok: true,
    binanceWeb3Rwa: Boolean(BINANCE_WEB3_API_KEY && BINANCE_WEB3_API_SECRET),
    rwaFallback: true,
    binanceAgentOs: agentOs,
  });
});

app.get("/", (_req, res) => {
  res.sendFile(APP_HTML);
});

app.listen(PORT, () => {
  console.log(`Phoveus backend proxy running at http://localhost:${PORT}`);
  console.log(`Allowed CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`Claude reasoning: ${anthropic ? "enabled" : "disabled (using heuristic fallback)"}`);
  console.log(`Binance Web3 RWA API: ${BINANCE_WEB3_API_KEY && BINANCE_WEB3_API_SECRET ? "configured" : "not configured"}`);
  console.log(`Binance Agent OS MCP: ${BINANCE_AGENT_OS_URL ? "OAuth enabled" : "not configured"}`);
});

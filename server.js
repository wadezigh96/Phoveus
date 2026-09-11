/**
 * Phoveus backend proxy
 * ---------------------
 * Tugas server ini cuma dua:
 *
 *  1. /api/agent-call   -> terima ringkasan pasar dari front-end, minta Claude
 *                          menghasilkan call trading (symbol/call/confidence/reasoning),
 *                          fallback ke heuristik lokal kalau Claude tidak tersedia.
 *
 *  2. /api/place-order  -> terima order yang SUDAH disetujui user di UI, lalu
 *                          meneruskannya ke Binance Agent OS MCP server lewat
 *                          tool `place_order`.
 *
 * PRINSIP KEAMANAN PENTING:
 *  - API key Claude dan token Binance Agent OS HANYA hidup di server ini
 *    (lewat file .env), TIDAK PERNAH dikirim ke browser.
 *  - /api/place-order menolak request yang tidak eksplisit mengandung
 *    `confirmed: true` — approval tetap dilakukan manusia di UI, server ini
 *    hanya meneruskan, bukan memutuskan sendiri untuk trading.
 *  - CORS dibatasi ke ALLOWED_ORIGIN saja, bukan wildcard "*".
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

// Rate limit sangat sederhana berbasis IP (in-memory). Untuk produksi,
// ganti dengan solusi yang lebih layak (mis. redis / API gateway).
const rateBuckets = new Map();
function simpleRateLimit(maxPerMinute = 20) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const windowMs = 60_000;
    const bucket = rateBuckets.get(key) ?? [];
    const recent = bucket.filter((t) => now - t < windowMs);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: "Terlalu banyak request, coba lagi sebentar." });
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    next();
  };
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

// ---------------------------------------------------------------------------
// 1) /api/agent-call — reasoning (Claude, dengan fallback heuristik lokal)
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
    reasoning = `${bestSym} naik ${chg.toFixed(2)}% dalam 24 jam terakhir — momentum jangka pendek cenderung positif.`;
  } else if (call === "short") {
    reasoning = `${bestSym} turun ${Math.abs(chg).toFixed(2)}% dalam 24 jam terakhir — tekanan jual masih terlihat.`;
  } else {
    reasoning = `${bestSym} relatif stabil (${chg.toFixed(2)}% dalam 24 jam) — belum ada sinyal arah yang kuat.`;
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
    return res.status(400).json({ error: "Body harus berisi symbols, prices, changePct." });
  }

  if (!anthropic) {
    return res.json(heuristicCall({ prices, changePct }));
  }

  try {
    const marketSummary = SYMBOLS.map((s) => `${s}: $${prices[s] ?? "—"} (${changePct[s]?.toFixed?.(2) ?? "—"}% / 24j)`).join(", ");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Kamu adalah trading agent untuk Phoveus, sebuah pasar prediksi simulasi yang terhubung ke Binance Agent OS.
Berikut harga pasar terkini: ${marketSummary}.
Pilih SATU simbol dari ${SYMBOLS.join(", ")} dan keluarkan satu call trading jangka pendek.
Balas HANYA dengan JSON tanpa markdown, format persis:
{"symbol":"BTCUSDT","call":"long|short|neutral","confidence":0-100,"reasoning":"1-2 kalimat singkat dalam bahasa Indonesia"}`,
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
    throw new Error("Respons Claude tidak sesuai format yang diharapkan.");
  } catch (err) {
    console.error("[/api/agent-call] Claude gagal, fallback ke heuristik:", err.message);
    return res.json(heuristicCall({ prices, changePct }));
  }
});

// ---------------------------------------------------------------------------
// 2) MCP client — koneksi ke Binance Agent OS
// ---------------------------------------------------------------------------

let mcpClientPromise = null;

function getMcpClient() {
  if (!BINANCE_AGENT_OS_URL || !BINANCE_AGENT_OS_TOKEN) {
    throw new Error(
      "BINANCE_AGENT_OS_URL / BINANCE_AGENT_OS_TOKEN belum diisi di .env — eksekusi order belum bisa dipakai."
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
      // Reset promise supaya percobaan berikutnya bisa retry, bukan stuck di error lama
      mcpClientPromise = null;
      throw err;
    });
  }
  return mcpClientPromise;
}

// Endpoint debug: lihat daftar tool yang benar-benar disediakan MCP server
// (nama & skema tool bisa berbeda dari asumsi — SELALU cek ini dulu sebelum
// mengandalkan nama/parameter tool "place_order" di bawah).
app.get("/api/tools", async (req, res) => {
  if (!ADMIN_DEBUG_KEY || req.query.key !== ADMIN_DEBUG_KEY) {
    return res.status(403).json({ error: "Tidak diizinkan." });
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
// 3) /api/place-order — eksekusi order NYATA, hanya setelah approval user
// ---------------------------------------------------------------------------

app.post("/api/place-order", simpleRateLimit(10), async (req, res) => {
  const { symbol, side, quantity, orderType = "MARKET", confirmed } = req.body ?? {};

  if (confirmed !== true) {
    return res.status(400).json({
      error: "Order ditolak: field 'confirmed' harus true. Approval eksplisit dari user wajib dilakukan di UI sebelum memanggil endpoint ini.",
    });
  }
  if (!SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: `Symbol tidak dikenal: ${symbol}` });
  }
  if (!["BUY", "SELL"].includes(side)) {
    return res.status(400).json({ error: "side harus 'BUY' atau 'SELL'." });
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ error: "quantity harus angka positif." });
  }

  try {
    const client = await getMcpClient();

    // NOTE: nama tool & bentuk argumen di bawah ini adalah ASUMSI berdasarkan
    // pola umum MCP trading server. Sebelum dipakai sungguhan, cek dulu lewat
    // GET /api/tools untuk memastikan nama tool & parameter yang benar sesuai
    // MCP server Binance Agent OS kamu, lalu sesuaikan bagian ini.
    const result = await client.callTool({
      name: "place_order",
      arguments: { symbol, side, quantity, type: orderType },
    });

    console.log("[/api/place-order] order terkirim:", { symbol, side, quantity, orderType });
    res.json({ ok: true, result });
  } catch (err) {
    console.error("[/api/place-order] gagal:", err.message);
    res.status(502).json({ error: `Gagal menghubungi Binance Agent OS MCP: ${err.message}` });
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Phoveus backend proxy jalan di http://localhost:${PORT}`);
  console.log(`CORS origin diizinkan: ${ALLOWED_ORIGIN}`);
  console.log(`Claude reasoning: ${anthropic ? "aktif" : "nonaktif (pakai fallback heuristik)"}`);
  console.log(`Binance Agent OS MCP: ${BINANCE_AGENT_OS_URL && BINANCE_AGENT_OS_TOKEN ? "dikonfigurasi" : "belum dikonfigurasi"}`);
});

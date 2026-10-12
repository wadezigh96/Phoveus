/**
 * Binance Web3 signed client for Phoveus.
 * Request path always includes /build per official auth docs.
 * Secrets stay in process.env; never log credentials or signatures.
 */
import crypto from "node:crypto";

export function buildBinanceWeb3Signature({
  secret,
  timestamp,
  method,
  requestPath,
  body = "",
}) {
  const preHash = timestamp + method.toUpperCase() + requestPath + body;
  return crypto.createHmac("sha256", secret).update(preHash).digest("base64");
}

export function buildWeb3Url(baseUrl, path, query = {}) {
  const base = String(baseUrl).replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function binanceWeb3Get({
  apiKey,
  apiSecret,
  baseUrl,
  path,
  query = {},
  fetchImpl = fetch,
}) {
  if (!apiKey || !apiSecret) {
    throw new Error("BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET are not configured.");
  }
  const url = buildWeb3Url(baseUrl, path, query);
  const requestPath = url.pathname + (url.search ? url.search : "");
  const timestamp = new Date().toISOString();
  const sign = buildBinanceWeb3Signature({
    secret: apiSecret,
    timestamp,
    method: "GET",
    requestPath,
    body: "",
  });
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      "X-OC-APIKEY": apiKey,
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
  if (!response.ok || (payload && payload.code !== undefined && payload.code !== 0)) {
    const err = new Error(payload?.msg || `Binance Web3 HTTP ${response.status}`);
    err.status = response.status || 502;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export function isBinanceRestrictedError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const upstream = String(err?.payload?.msg || err?.upstreamMsg || "").toLowerCase();
  const status = Number(err?.status || err?.payload?.status || 0);
  return (
    status === 451 ||
    msg.includes("restricted location") ||
    upstream.includes("restricted location") ||
    upstream.includes("eligibility") ||
    err?.payload?.code === 40301 ||
    err?.payload?.code === 40302 ||
    err?.payload?.code === 40303
  );
}

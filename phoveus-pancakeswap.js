/**
 * PancakeSwap BNB Chain pool reader for Phoveus.
 *
 * Reads public indexed pool analytics only. It never connects to a wallet,
 * builds swap calldata, approves tokens, signs, or broadcasts transactions.
 * APR/TVL/volume are informational and may be delayed or absent.
 */
const PANCAKESWAP_API_BASE = "https://explorer.pancakeswap.com";
const BSC_CHAIN_KEY = "bsc";
const SUPPORTED_PROTOCOLS = ["v2", "v3", "stable", "infinityBin", "infinityCl", "infinityStable"];

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.rows,
    payload?.data,
    payload?.pools,
    payload?.result,
    payload?.data?.rows,
    payload?.data?.pools,
    payload?.result?.rows,
    payload?.result?.pools,
  ];
  return candidates.find(Array.isArray) || [];
}

function chainIsBsc(pool) {
  const raw = pool?.chainId ?? pool?.chain ?? pool?.chainKey ?? pool?.network;
  if (raw === undefined || raw === null || raw === "") return true;
  const value = String(typeof raw === "object" ? raw.id ?? raw.name ?? raw.key ?? "" : raw).trim().toLowerCase();
  return value === "56" || value === "bsc" || value === "bnb" || value === "bnb chain" || value === "bnb smart chain";
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizePool(pool) {
  if (!pool || typeof pool !== "object" || !chainIsBsc(pool)) return null;
  const token0 = pool.token0 ?? pool.tokenA ?? {};
  const token1 = pool.token1 ?? pool.tokenB ?? {};
  const pair = firstValue(pool, ["name", "poolName", "pair", "symbol"]) ??
    [token0?.symbol ?? token0?.name ?? pool.token0Symbol, token1?.symbol ?? token1?.name ?? pool.token1Symbol].filter(Boolean).join(" / ");
  const tvl = numericOrNull(firstValue(pool, ["tvlUSD", "tvlUsd", "tvl", "liquidityUSD", "liquidityUsd"]));
  const volume24h = numericOrNull(firstValue(pool, ["volumeUSD24h", "volumeUsd24h", "volume24hUSD", "volume24h", "volumeUSD"]));
  const apr24h = numericOrNull(firstValue(pool, ["apr24h", "apr24H", "apr", "feeApr24h"]));
  const protocol = firstValue(pool, ["protocol", "protocolName", "type"]);
  return {
    name: String(pair || "Pool pair unavailable").slice(0, 100),
    protocol: String(protocol || "PancakeSwap pool").slice(0, 40),
    tvlUsd: tvl,
    volume24hUsd: volume24h,
    apr24h,
    poolAddress: String(firstValue(pool, ["id", "address", "poolAddress"]) || ""),
  };
}

export async function readPancakeSwapBscPools() {
  const url = new URL("/api/cached/pools/list", PANCAKESWAP_API_BASE);
  url.searchParams.set("orderBy", "volumeUSD24h");
  for (const protocol of SUPPORTED_PROTOCOLS) url.searchParams.append("protocols", protocol);
  url.searchParams.append("chains", BSC_CHAIN_KEY);
  url.searchParams.set("limit", "10");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error("PancakeSwap pool analytics are unavailable.");
  }

  const rows = getRows(payload).map(normalizePool).filter(Boolean);
  if (!rows.length) {
    throw new Error("PancakeSwap API returned no usable BNB Chain pool rows.");
  }

  return {
    ok: true,
    protocol: "PancakeSwap",
    chainId: "56",
    chain: "BNB Smart Chain",
    pools: rows.slice(0, 10),
    source: "pancakeswap-explorer-indexed",
    fetchedAt: new Date().toISOString(),
    readOnly: true,
    executionLocked: true,
    orderForwarded: false,
    transactionBuilt: false,
    note: "Indexed pool analytics only. Values can be delayed or missing; no wallet, swap quote, slippage, token audit, or transaction simulation is verified.",
  };
}

export const PANCAKESWAP_BSC_CONFIG = Object.freeze({
  chainId: "56",
  chain: BSC_CHAIN_KEY,
  protocols: SUPPORTED_PROTOCOLS,
});

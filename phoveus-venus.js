/**
 * Venus Protocol read-only market adapter.
 *
 * This module only reads indexed Venus market data.
 * It never builds, signs, or broadcasts transactions.
 *
 * Live transaction safety still requires direct RPC reads before execution.
 */

const VENUS_API_BASE = "https://api.venus.io";
const BSC_MAINNET_CHAIN_ID = "56";
const VBNB_MAINNET = "0xA07c5b74C9B40447a954e1466938b865b6BBea36";

function normalizeAddress(value) {
  const address = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid EVM address.");
  }
  return address;
}

export async function readVenusBnbMarket({ accountAddress = "" } = {}) {
  const url = new URL("/markets", VENUS_API_BASE);
  url.searchParams.set("chainId", BSC_MAINNET_CHAIN_ID);
  url.searchParams.set("address", VBNB_MAINNET);
  url.searchParams.set("limit", "1");

  const headers = { accept: "application/json" };
  if (accountAddress) {
    headers["accept-version"] = "next";
    url.searchParams.set("accountAddress", normalizeAddress(accountAddress));
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload || !Array.isArray(payload.result) || !payload.result[0]) {
    throw new Error("Venus BNB market data is unavailable.");
  }

  const market = payload.result[0];
  return {
    chainId: BSC_MAINNET_CHAIN_ID,
    marketAddress: VBNB_MAINNET,
    symbol: market.symbol || "vBNB",
    name: market.name || "Venus BNB",
    isListed: market.isListed === true,
    supplyApy: market.supplyApy ?? null,
    borrowApy: market.borrowApy ?? null,
    supplyApyDecimal: market.supplyApyDecimal ?? null,
    borrowApyDecimal: market.borrowApyDecimal ?? null,
    exchangeRateMantissa: market.exchangeRateMantissa ?? null,
    underlyingPriceMantissa: market.underlyingPriceMantissa ?? null,
    liquidityCents: market.liquidityCents ?? null,
    pausedActionsBitmap: market.pausedActionsBitmap ?? null,
    supplierCount: market.supplierCount ?? null,
    source: "venus-api-indexed",
    executionLocked: true,
    readOnly: true,
    note: "Indexed data is informational. Do not use it alone for transaction simulation, balances, permissions, pause state, or execution safety.",
  };
}

export { BSC_MAINNET_CHAIN_ID, VBNB_MAINNET };

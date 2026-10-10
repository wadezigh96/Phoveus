/**
 * Venus USDT Earn market reader for Phoveus.
 *
 * Read-only indexed market data on BNB Smart Chain (chainId 56).
 * This endpoint/module does not call Binance Agent Wallet, approve tokens,
 * sign transactions, or broadcast deposits/redeems.
 *
 * Venus API data is informational and must not be treated as a transaction
 * simulation or a guarantee of APY. The Binance BAW investment ID is retained
 * as catalog provenance only; it is not a Venus contract address.
 */

const BSC_MAINNET_CHAIN_ID = "56";
const VENUS_USDT_MARKET = "0xfd5840cd36d94d7229439859c0112a4185bc0255";
const USDT_UNDERLYING = "0x55d398326f99059ff775485246999027b3197955";
const BAW_INVESTMENT_ID =
  "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb";
const VENUS_API_BASE = "https://api.venus.io";

export async function readVenusUsdtEarn() {
  const url = new URL("/markets", VENUS_API_BASE);
  url.searchParams.set("chainId", BSC_MAINNET_CHAIN_ID);
  url.searchParams.set("address", VENUS_USDT_MARKET);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null);
  const market = Array.isArray(payload?.result)
    ? payload.result.find((item) =>
        String(item?.address || "").toLowerCase() === VENUS_USDT_MARKET &&
        String(item?.chainId || "") === BSC_MAINNET_CHAIN_ID
      )
    : null;

  if (!response.ok || !market) {
    throw new Error("Venus USDT market data is unavailable or did not match the expected BSC market.");
  }

  const numericOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  return {
    ok: true,
    protocol: "Venus",
    chainId: BSC_MAINNET_CHAIN_ID,
    asset: {
      symbol: "USDT",
      tokenAddress: USDT_UNDERLYING,
    },
    market: {
      symbol: market.symbol || "vUSDT",
      name: market.name || "Venus USDT",
      marketAddress: VENUS_USDT_MARKET,
      isListed: market.isListed === true,
      supplyApy: numericOrNull(market.supplyApy),
      supplyApyDecimal: numericOrNull(market.supplyApyDecimal),
      borrowApy: numericOrNull(market.borrowApy),
      borrowApyDecimal: numericOrNull(market.borrowApyDecimal),
      liquidityCents: numericOrNull(market.liquidityCents),
      pausedActionsBitmap: numericOrNull(market.pausedActionsBitmap),
      supplierCount: numericOrNull(market.supplierCount),
    },
    catalog: {
      source: "Binance Agent Wallet CLI snapshot supplied by operator",
      investmentId: BAW_INVESTMENT_ID,
      reportedApyDisplay: null,
      note: "Fetch current APY from Venus API; Binance BAW catalog APY is not assumed current.",
    },
    source: "venus-api-indexed",
    fetchedAt: new Date().toISOString(),
    readOnly: true,
    executionLocked: true,
    orderForwarded: false,
    transactionPreviewAvailable: false,
    note: "Indexed market data only. No wallet balance, allowance, pause safety, transaction simulation, or execution is verified by this response.",
  };
}

export const VENUS_USDT_EARN_CONFIG = Object.freeze({
  chainId: BSC_MAINNET_CHAIN_ID,
  investmentId: BAW_INVESTMENT_ID,
  underlyingTokenAddress: USDT_UNDERLYING,
  marketTokenAddress: VENUS_USDT_MARKET,
});

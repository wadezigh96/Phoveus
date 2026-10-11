const ASSETS = Object.freeze({
  NVDAB: {
    symbol: "NVDAB",
    ticker: "NVDA",
    chainId: "56",
    contractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
  },
});

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function readBinanceRwaMarketData({
  symbol = "NVDAB",
  fetchImpl = fetch,
} = {}) {
  const key = String(symbol).trim().toUpperCase();
  const asset = ASSETS[key];

  if (!asset) throw new Error("Unsupported RWA symbol.");

  const url = new URL(
    "https://www.binance.com/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai",
  );
  url.searchParams.set("chainId", asset.chainId);
  url.searchParams.set("contractAddress", asset.contractAddress);

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Binance RWA HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (
    payload?.code !== "000000" ||
    !payload.data ||
    payload.data.symbol !== asset.symbol
  ) {
    throw new Error("Binance RWA market data unavailable or mismatched.");
  }

  const tokenInfo = payload.data.tokenInfo || {};
  const stockInfo = payload.data.stockInfo || {};
  const rawDividendYield = numericOrNull(stockInfo.dividendYield);

  return {
    symbol: asset.symbol,
    ticker: asset.ticker,
    chainId: 56,
    contractAddress: asset.contractAddress,
    tokenPriceUsd: numericOrNull(tokenInfo.price),
    sharesMultiplier: numericOrNull(tokenInfo.sharesMultiplier),
    tokenApyRaw: tokenInfo.apy ?? null,
    tokenApyPct: null,
    underlyingStock: {
      ticker: asset.ticker,
      dividendYieldRaw: rawDividendYield,
      dividendYieldPct:
        rawDividendYield === null ? null : rawDividendYield * 100,
      dividendYieldSource: "binance-rwa-stockInfo",
      note:
        "Underlying stock dividend yield only; not proof of token payouts or guaranteed RWA yield.",
    },
    source: "binance-public-rwa-dynamic",
    readOnly: true,
    executionLocked: true,
    orderForwarded: false,
  };
}

export { ASSETS };

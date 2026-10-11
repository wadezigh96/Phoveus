const CMC_URL =
  "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest";

export async function getCmcQuote({
  symbol = "NVDAB",
  apiKey = process.env.CMC_API_KEY,
  fetchImpl = fetch,
} = {}) {
  const cleanSymbol = String(symbol).trim().toUpperCase();

  if (!/^[A-Z0-9]{2,15}$/.test(cleanSymbol)) {
    throw new Error("Invalid asset symbol");
  }
  if (!apiKey) throw new Error("CMC_API_KEY is not configured");

  const url = new URL(CMC_URL);
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("convert", "USD");

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "X-CMC_PRO_API_KEY": apiKey,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`CoinMarketCap HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status?.error_code !== 0) {
    throw new Error("CoinMarketCap API request failed");
  }

  const value = payload.data?.[cleanSymbol];
  const assets = Array.isArray(value) ? value : value ? [value] : [];

  return {
    ok: true,
    provider: "coinmarketcap",
    symbol: cleanSymbol,
    quotes: assets.map((asset) => ({
      name: asset.name ?? null,
      cmcId: asset.id ?? null,
      priceUsd: asset.quote?.USD?.price ?? null,
      lastUpdated: asset.quote?.USD?.last_updated ?? null,
    })),
    contractVerified: false,
    dividendYieldPct: null,
    readOnly: true,
    executionLocked: true,
    orderForwarded: false,
    note: "CMC price is not proof of the BNB Chain token price or contract identity.",
  };
}

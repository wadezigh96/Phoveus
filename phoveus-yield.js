/**
 * Read-only comparison of an underlying stock's dividend yield and BNB Simple Earn flexible APY.
 *
 * Binance Web3 dividendYield is reported in percentage points (for example 0.12 means 0.12%).
 * Binance Simple Earn product.apy is a decimal (for example 0.00171665 means 0.171665%).
 * These are different measures; the result is informational, not a trade signal.
 */

export function parseRwaDividendYieldPct(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

export function parseBnbDecimalApyPct(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return Number((n * 100).toFixed(4));
}

export function compareRwaBnbYield({ rwaYieldPct, bnbYieldPct }) {
  const rwa = parseRwaDividendYieldPct(rwaYieldPct);
  const bnb = parseRwaDividendYieldPct(bnbYieldPct);
  if (rwa === null || bnb === null) {
    return {
      spreadPct: null,
      relation: "INCOMPLETE",
      note: "Spread is withheld because RWA dividend yield or BNB flexible APY is missing.",
    };
  }
  const spreadPct = Number((rwa - bnb).toFixed(4));
  return {
    spreadPct,
    relation: spreadPct > 0 ? "RWA_ABOVE_BNB" : spreadPct < 0 ? "RWA_BELOW_BNB" : "MATCH",
    note: "Informational comparison only. Underlying-stock dividend yield is not token APY or a guaranteed payout; execution remains locked.",
  };
}

export function readUnderlyingYield(profile) {
  const data = profile?.data || profile || {};
  const yieldPct = parseRwaDividendYieldPct(data.dividendYield);
  return {
    dividendYieldPct: yieldPct,
    latestDividend: data.latestDividend ?? null,
    unit: "percent",
    sourceField: "dividendYield",
  };
}

/**
 * Read only an enabled, zero-duration BNB flexible Simple Earn product.
 * Does not substitute fixed-term products, other assets, or market APR for APY.
 */
export function readBnbFlexibleApy(payload) {
  const parents = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  const parent = parents.find(
    (item) => String(item?.asset || "").toUpperCase() === "BNB",
  );
  const products = Array.isArray(parent?.productDetailList)
    ? parent.productDetailList
    : [];
  const product = products.find((item) =>
    String(item?.productType || "").toUpperCase() === "LENDING_FLEXIBLE" &&
    Number(item?.duration) === 0 &&
    String(item?.status || "").toUpperCase() === "ENABLE"
  );
  const apy = parseBnbDecimalApyPct(product?.apy);
  return {
    apyPct: apy,
    asset: parent ? "BNB" : null,
    productId: product?.productId ? String(product.productId) : null,
    productType: product?.productType || null,
    rateType: "APY",
    unit: "percent",
    sourceField: "apy",
  };
}

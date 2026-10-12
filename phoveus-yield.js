/**
 * RWA / BNB yield utility.
 *
 * RWA dividend yield comes from Binance Web3 underlying-profile.
 * Binance documents dividendYield "0.85" as 0.85 percent.
 * BNB Simple Earn latestAnnualPercentageRate "0.05" (official SAPI) or
 * latestAnnualInterestRate (public bapi) is a decimal rate, so 5 percent.
 * Missing either input leaves the spread empty. Nothing here authorizes an order.
 */

export function parseRwaDividendYieldPct(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

export function parseBnbDecimalAprPct(value) {
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
      note: "Spread is withheld because RWA dividend yield or BNB yield is missing.",
    };
  }
  const spreadPct = Number((rwa - bnb).toFixed(4));
  return {
    spreadPct,
    relation: spreadPct > 0 ? "RWA_ABOVE_BNB" : spreadPct < 0 ? "RWA_BELOW_BNB" : "MATCH",
    note: "Informational spread only. Dividend yield is not a trade signal and does not unlock execution.",
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

function extractBnbRows(payload) {
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function readBnbFlexibleApr(payload) {
  const rows = extractBnbRows(payload);
  const row = rows.find((item) => String(item?.asset || "").toUpperCase() === "BNB") || rows[0];
  // Official SAPI: latestAnnualPercentageRate (decimal). Public bapi: latestAnnualInterestRate (decimal).
  const rawRate = row?.latestAnnualPercentageRate ?? row?.latestAnnualInterestRate ?? null;
  const sourceField = row?.latestAnnualPercentageRate != null
    ? "latestAnnualPercentageRate"
    : row?.latestAnnualInterestRate != null
      ? "latestAnnualInterestRate"
      : null;
  const apr = parseBnbDecimalAprPct(rawRate);
  return {
    aprPct: apr,
    asset: row?.asset ? String(row.asset).toUpperCase() : "BNB",
    productId: row?.productId ? String(row.productId) : (row?.id ? String(row.id) : null),
    unit: "percent",
    sourceField,
  };
}

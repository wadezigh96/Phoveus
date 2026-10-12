/**
 * Pure status helpers for RWA / BNB yield integration.
 * Never invent yields. Classify config, restriction, and upstream failures.
 */

export function classifyRwaSource({ configured, restricted, hasYield, emptyContract }) {
  if (!configured) return "config-missing";
  if (restricted) return "restricted";
  if (emptyContract) return "unavailable";
  if (hasYield) return "binance-web3";
  return "binance-missing-yield";
}

export function classifyBnbSource({ configured, restricted, hasApr, usedSapi }) {
  if (restricted) return "restricted";
  if (!configured && !hasApr) return "config-missing";
  if (hasApr) return usedSapi ? "binance-sapi-simple-earn" : "binance-public-bapi";
  return "binance-missing-apr";
}

export function isRestrictedStatus(status, message = "") {
  const msg = String(message || "").toLowerCase();
  return (
    Number(status) === 451 ||
    msg.includes("restricted location") ||
    msg.includes("eligibility")
  );
}

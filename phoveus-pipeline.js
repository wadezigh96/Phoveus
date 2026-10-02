/**
 * Phoveus conceptual pipeline.
 *
 * Tokenized Securities Discovery
 *   -> Token Identity
 *   -> Token Audit
 *   -> RWA Research
 *   -> Market Clock
 *   -> Risk Guard
 *   -> Agent Reasoning
 *   -> Human Approval
 *   -> Agentic Wallet / Agent OS adapter
 *
 * Missing, restricted, stale, or unverified data fails closed.
 * No stage invents a price, contract, audit score, or live order.
 */

export const PHOVEUS_PIPELINE = [
  "tokenized-securities-discovery",
  "token-identity",
  "token-audit",
  "rwa-research",
  "market-clock",
  "risk-guard",
  "agent-reasoning",
  "human-approval",
  "agentic-wallet-or-agent-os",
];

export const GUARDED_STATES = ["REOPENING", "REFERENCE_LAG", "DATA_RESTRICTED", "NO_ASSET", "STALE_REFERENCE"];
export const STALE_SNAPSHOT_SECONDS = 15 * 60;

const STAGE_NAMES = {
  "tokenized-securities-discovery": "Tokenized Securities Discovery",
  "token-identity": "Token Identity",
  "token-audit": "Token Audit",
  "rwa-research": "RWA Research",
  "market-clock": "Market Clock",
  "risk-guard": "Risk Guard",
  "agent-reasoning": "Agent Reasoning",
  "human-approval": "Human Approval",
  "agentic-wallet-or-agent-os": "Agentic Wallet / Agent OS",
};

export function classifyRwaMarketState({ openState, marketStatus, nextOpenTime, divergencePct, snapshotAgeSeconds }) {
  const now = Date.now();
  const nextOpen = Number(nextOpenTime || 0);
  const minutesToOpen = nextOpen > now ? (nextOpen - now) / 60000 : null;
  const age = Number(snapshotAgeSeconds);

  if (Number.isFinite(age) && age > STALE_SNAPSHOT_SECONDS) {
    return { state: "STALE_REFERENCE", reason: "Reference snapshot is older than 15 minutes." };
  }
  if (openState === true || marketStatus === "regular") {
    return { state: "OPEN", reason: "Underlying market is open." };
  }
  if (minutesToOpen !== null && minutesToOpen <= 60) {
    return { state: "REOPENING", reason: "Underlying market is scheduled to reopen within 60 minutes." };
  }
  if (typeof divergencePct === "number" && Math.abs(divergencePct) >= 1) {
    return { state: "REFERENCE_LAG", reason: "Underlying market is closed and the on-chain/reference prices are diverging." };
  }
  return { state: "CLOSED", reason: "Underlying market is closed." };
}

function stage(id, status, detail, ok) {
  return {
    id,
    name: STAGE_NAMES[id] || id,
    status,
    detail,
    ok: Boolean(ok),
  };
}

function lockedResult({ symbol, platformId, source, degraded, state, reason, asset, intelligence, stages, error }) {
  const ordered = PHOVEUS_PIPELINE.map((id) => stages.find((item) => item.id === id) || stage(id, "SKIPPED", "Not reached because an earlier stage failed closed.", false));
  return {
    ok: true,
    source,
    degraded: Boolean(degraded),
    asset: asset || { symbol, platformId },
    decision: "WAIT",
    executionLocked: true,
    humanApprovalRequired: true,
    rationale: reason,
    error: error || null,
    intelligence: {
      state,
      reason,
      executionLocked: true,
      divergencePct: null,
      tokenPrice: null,
      referencePrice: null,
      snapshotAgeSeconds: null,
      nextOpenTime: null,
      ...(intelligence || {}),
      executionLocked: true,
    },
    pipeline: PHOVEUS_PIPELINE,
    stages: ordered,
  };
}

export async function runPhoveusPipeline({
  symbol,
  platformId = "bstock",
  search,
  price,
  underlyingMarket,
  isRestricted,
  reason,
  walletAdapter,
}) {
  const normalized = String(symbol || "NVDA").trim().toUpperCase();
  const platform = String(platformId || "bstock").trim().toLowerCase();
  const stages = [];

  if (!/^[A-Z0-9._-]{1,20}$/.test(normalized) || !["ondo", "bstock"].includes(platform)) {
    stages.push(stage("tokenized-securities-discovery", "REJECTED", "Ticker or platform is outside the tokenized-stock flow.", false));
    return lockedResult({
      symbol: normalized,
      platformId: platform,
      source: "phoveus",
      degraded: true,
      state: "DATA_RESTRICTED",
      reason: "Invalid tokenized-stock request. Execution remains locked.",
      stages,
    });
  }

  let searchPayload;
  try {
    searchPayload = await search({ keyword: normalized, platformId: platform });
  } catch (err) {
    const restricted = typeof isRestricted === "function" ? isRestricted(err) : false;
    stages.push(stage(
      "tokenized-securities-discovery",
      restricted ? "RESTRICTED" : "UNAVAILABLE",
      restricted
        ? "Binance Web3 returned a restricted-location response. Demo catalog only; no live price is claimed."
        : "Tokenized-securities discovery is unavailable. No contract was inferred.",
      false
    ));
    return lockedResult({
      symbol: normalized,
      platformId: platform,
      source: "fallback-demo",
      degraded: true,
      state: "DATA_RESTRICTED",
      reason: "Live RWA discovery is unavailable. Decision is WAIT and execution remains locked.",
      stages,
      error: restricted ? "restricted-location" : "rwa-discovery-unavailable",
    });
  }

  const rows = Array.isArray(searchPayload?.data) ? searchPayload.data : [];
  const ticker = rows.find((item) => String(item?.ticker || "").toUpperCase() === normalized) || null;
  const asset = ticker?.assets?.find((item) => String(item?.binanceChainId) === "56") || null;
  stages.push(stage(
    "tokenized-securities-discovery",
    ticker ? "FOUND" : "NOT_FOUND",
    ticker
      ? `${ticker.companyName || normalized} found on ${platform}.`
      : "No supported tokenized-stock representation was returned. Contract was not inferred from the ticker.",
    Boolean(ticker)
  ));

  if (!ticker || !asset?.tokenContractAddress) {
    stages.push(stage("token-identity", "UNRESOLVED", "No BNB Chain contract was returned by discovery.", false));
    return lockedResult({
      symbol: normalized,
      platformId: platform,
      source: "binance",
      degraded: false,
      state: "NO_ASSET",
      reason: "No supported BNB Chain tokenized asset was found.",
      asset: { symbol: normalized, platformId: platform },
      stages,
    });
  }

  const chainId = String(asset.binanceChainId || "");
  const address = String(asset.tokenContractAddress || "");
  const identityOk = chainId === "56" && /^0x[a-fA-F0-9]{40}$/.test(address);
  stages.push(stage(
    "token-identity",
    identityOk ? "RESOLVED" : "UNRESOLVED",
    identityOk
      ? `Chain 56 · ${address}`
      : "Identity is incomplete. A ticker alone is not treated as a contract.",
    identityOk
  ));

  const provider = String(asset.platformId || platform);
  const auditOk = identityOk && ["bstock", "ondo"].includes(provider);
  stages.push(stage(
    "token-audit",
    auditOk ? "CONTEXT_CHECKED" : "UNRESOLVED",
    auditOk
      ? `Provider ${provider} is allowlisted. No live audit score was invented.`
      : "Token audit context is unresolved, so execution stays locked.",
    auditOk
  ));

  if (!identityOk || !auditOk) {
    return lockedResult({
      symbol: normalized,
      platformId: platform,
      source: "binance",
      state: "DATA_RESTRICTED",
      reason: "Token identity or audit context is incomplete. Execution remains locked.",
      asset: { symbol: ticker.ticker || normalized, platformId: provider, chainId, tokenContractAddress: address },
      stages,
    });
  }

  let priceResult;
  let marketResult;
  try {
    [priceResult, marketResult] = await Promise.all([
      price({ binanceChainId: chainId, tokenContractAddresses: address }),
      underlyingMarket({ binanceChainId: chainId, tokenContractAddress: address }),
    ]);
  } catch (err) {
    const restricted = typeof isRestricted === "function" ? isRestricted(err) : false;
    stages.push(stage(
      "rwa-research",
      restricted ? "RESTRICTED" : "UNAVAILABLE",
      "Price or underlying-market research failed. No price was synthesized.",
      false
    ));
    return lockedResult({
      symbol: normalized,
      platformId: platform,
      source: "fallback-demo",
      degraded: true,
      state: "DATA_RESTRICTED",
      reason: "Live RWA research is unavailable. Decision is WAIT and execution remains locked.",
      asset: {
        symbol: ticker.ticker || normalized,
        name: ticker.companyName || "Tokenized stock",
        platformId: provider,
        chainId,
        tokenContractAddress: address,
      },
      stages,
      error: restricted ? "restricted-location" : "rwa-research-unavailable",
    });
  }

  const priceRow = Array.isArray(priceResult?.data) ? priceResult.data[0] : null;
  const market = marketResult?.data || {};
  const status = market.statusInfo || {};
  const tokenPrice = Number(priceRow?.tokenPrice);
  const referencePrice = Number(priceRow?.referencePrice);
  const hasPrices = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice !== 0;
  const divergencePct = hasPrices ? ((tokenPrice - referencePrice) / referencePrice) * 100 : null;
  const snapshotMs = Number(marketResult?.timestamp || priceResult?.timestamp || 0);
  const snapshotAgeSeconds = snapshotMs ? Math.max(0, Math.round((Date.now() - snapshotMs) / 1000)) : null;

  stages.push(stage(
    "rwa-research",
    "LOADED",
    hasPrices ? "Token and reference prices loaded from Binance Web3." : "Research loaded, but a required price is missing.",
    true
  ));

  const classification = classifyRwaMarketState({
    openState: status.openState,
    marketStatus: status.marketStatus,
    nextOpenTime: status.nextOpenTime,
    divergencePct,
    snapshotAgeSeconds,
  });
  stages.push(stage(
    "market-clock",
    classification.state,
    classification.reason,
    classification.state !== "STALE_REFERENCE"
  ));

  const missingPriceLock = !hasPrices;
  const executionLocked =
    missingPriceLock ||
    GUARDED_STATES.includes(classification.state) ||
    classification.state === "STALE_REFERENCE";
  const guardReason = missingPriceLock
    ? "A token or reference price is missing, so divergence is not claimed and execution is locked."
    : classification.reason;
  stages.push(stage(
    "risk-guard",
    executionLocked ? "EXECUTION_LOCKED" : "CLEAR",
    guardReason,
    !executionLocked
  ));

  let decision = executionLocked ? "WAIT" : "REVIEW";
  let rationale = executionLocked
    ? guardReason
    : "Market-clock guard is clear. No automatic execution decision is made.";
  let reasoningSource = "deterministic-guard";
  if (!executionLocked && typeof reason === "function") {
    try {
      const reasoned = await reason({
        symbol: normalized,
        platformId: platform,
        state: classification.state,
        divergencePct,
        marketStatus: status.marketStatus || null,
      });
      if (reasoned?.decision === "WAIT" || reasoned?.decision === "REVIEW") {
        decision = reasoned.decision;
        rationale = String(reasoned.rationale || rationale).slice(0, 500);
        reasoningSource = "claude";
      }
    } catch {
      reasoningSource = "deterministic-guard";
    }
  }
  stages.push(stage(
    "agent-reasoning",
    decision,
    rationale,
    true
  ));
  stages.push(stage(
    "human-approval",
    "REQUIRED",
    "Explicit user confirmation is required before any state-changing action.",
    true
  ));

  const adapter = typeof walletAdapter === "function" ? walletAdapter() : { connected: false, schemaVerified: false };
  stages.push(stage(
    "agentic-wallet-or-agent-os",
    adapter.schemaVerified ? "SCHEMA_VERIFIED" : "LOCKED",
    adapter.schemaVerified
      ? "Wallet adapter schema is verified. Human approval is still required."
      : "Agentic Wallet / Agent OS schema is not verified. No order is sent.",
    false
  ));

  const intelligence = {
    state: classification.state,
    reason: classification.reason,
    executionLocked,
    marketStatus: status.marketStatus || null,
    openState: status.openState ?? null,
    nextOpenTime: status.nextOpenTime || null,
    nextCloseTime: status.nextCloseTime || null,
    tokenPrice: Number.isFinite(tokenPrice) ? tokenPrice : null,
    referencePrice: Number.isFinite(referencePrice) ? referencePrice : null,
    divergencePct: Number.isFinite(divergencePct) ? Number(divergencePct.toFixed(4)) : null,
    tokenPriceUpdatedAt: priceRow?.tokenPriceUpdatedAt || null,
    snapshotAgeSeconds,
  };

  return {
    ok: true,
    source: "binance",
    degraded: false,
    asset: {
      symbol: ticker.ticker || normalized,
      name: ticker.companyName || "Tokenized stock",
      platformId: provider,
      chainId,
      tokenContractAddress: address,
      tokenSymbol: asset.tokenSymbol || null,
    },
    decision,
    executionLocked,
    orderForwarded: false,
    humanApprovalRequired: true,
    rationale,
    reasoningSource,
    intelligence,
    pipeline: PHOVEUS_PIPELINE,
    stages,
  };
}

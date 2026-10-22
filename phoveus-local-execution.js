import crypto from "node:crypto";

const CHAIN_ID = "56";
const TTL_MS = 60_000;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

// Only well-known BNB Chain assets are eligible. Product IDs are deliberately
// resolved from the live BAW catalog; they must never be guessed or hard-coded.
export const SAFE_BSC_TOKENS = Object.freeze({
  USDT: "0x55d398326f99059ff775485246999027b3197955",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  CAKE: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
  USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
});
const SAFE_TOKEN_SET = new Set(Object.values(SAFE_BSC_TOKENS).map((v) => v.toLowerCase()));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeId(value, field) {
  const valueString = String(value ?? "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(valueString)) throw new Error("Invalid " + field + ".");
  return valueString;
}
function amount(value) {
  const valueString = String(value ?? "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(valueString) || !Number.isFinite(Number(valueString)) || Number(valueString) <= 0) {
    throw new Error("Invalid positive amount.");
  }
  return valueString;
}
function integer(value, max = 1_000_000_000) {
  const valueString = String(value ?? "");
  const n = Number(valueString);
  if (!/^\d+$/.test(valueString) || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error("Invalid positive integer.");
  return valueString;
}
function ratio(value) {
  const valueString = String(value ?? "");
  const n = Number(valueString);
  if (!/^(?:0?\.\d+|1(?:\.0+)?)$/.test(valueString) || n <= 0 || n > 1) throw new Error("Invalid ratio.");
  return valueString;
}
function slippage(value = "auto") {
  const valueString = String(value);
  if (valueString !== "auto" && (!/^\d+$/.test(valueString) || Number(valueString) < 1 || Number(valueString) > 4999)) {
    throw new Error("Invalid slippage.");
  }
  return valueString;
}
function tokenAddress(value) {
  const valueString = String(value ?? "");
  if (!ADDRESS.test(valueString) || !SAFE_TOKEN_SET.has(valueString.toLowerCase())) {
    throw new Error("Token is not on the fixed BNB Chain asset allowlist.");
  }
  return valueString;
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}
function unwrap(result) {
  if (result?.success !== true || !result.data || typeof result.data !== "object") {
    throw new Error("BAW returned an unsuccessful or unexpected response; action blocked.");
  }
  return result.data;
}
function chainIsBsc(value) {
  return String(value ?? "") === CHAIN_ID;
}
function normalizeAction(value) {
  const action = String(value ?? "").toLowerCase();
  if (!["deposit", "redeem", "lp-add", "lp-remove"].includes(action)) {
    throw new Error("Unsupported action. Use deposit, redeem, lp-add, or lp-remove.");
  }
  return action;
}

export function normalizeLocalExecutionIntent(input) {
  const action = normalizeAction(input?.action);
  const intent = {
    chainId: CHAIN_ID,
    action,
    investmentId: safeId(input?.investmentId, "investment ID"),
  };

  if (action === "deposit") {
    intent.tokenAddress = tokenAddress(input.tokenAddress);
    if (intent.tokenAddress.toLowerCase() !== SAFE_BSC_TOKENS.USDT.toLowerCase()) {
      throw new Error("Venus deposits are currently restricted to the verified BNB Chain USDT asset.");
    }
    intent.amount = amount(input.amount);
  } else if (action === "redeem") {
    intent.tokenAddress = tokenAddress(input.tokenAddress);
    if (intent.tokenAddress.toLowerCase() !== SAFE_BSC_TOKENS.USDT.toLowerCase()) {
      throw new Error("Venus redemptions are currently restricted to the verified BNB Chain USDT asset.");
    }
    const hasAmount = input.amount != null && input.amount !== "";
    const hasRatio = input.ratio != null && input.ratio !== "";
    if (hasAmount === hasRatio) throw new Error("Provide exactly one of amount or ratio for redeem.");
    if (hasAmount) intent.amount = amount(input.amount);
    else intent.ratio = ratio(input.ratio);
  } else if (action === "lp-add") {
    intent.tokenAddress = tokenAddress(input.tokenAddress);
    intent.amount = amount(input.amount);
    intent.slippageBps = slippage(input.slippageBps);
    const hasNft = input.nftId != null && input.nftId !== "";
    const hasRange = input.priceRange != null && input.priceRange !== "";
    if (hasNft === hasRange) throw new Error("LP add requires exactly one of nftId (top-up) or priceRange (new position).");
    if (hasNft) intent.nftId = integer(input.nftId);
    else {
      const range = integer(input.priceRange, 100);
      intent.priceRange = range;
    }
  } else {
    intent.nftId = integer(input.nftId);
    intent.ratio = ratio(input.ratio);
    intent.slippageBps = slippage(input.slippageBps);
  }
  return Object.freeze(intent);
}

function commandArgs(intent, phase, productInfo) {
  const previewing = phase === "preview";
  const actionFlag = {
    deposit: "DEPOSIT",
    redeem: "REDEEM",
    "lp-add": "LP-ADD",
    "lp-remove": "LP-REMOVE",
  }[intent.action];
  const args = previewing
    ? ["defi", "preview", "--action", actionFlag]
    : ["defi", intent.action];

  args.push("--investmentId", intent.investmentId);
  if (previewing) {
    args.push("--defiProtocolId", intent.defiProtocolId, "--binanceChainId", CHAIN_ID);
  }
  for (const [key, flag] of [
    ["tokenAddress", "--tokenAddress"],
    ["amount", "--amount"],
    ["ratio", "--ratio"],
    ["nftId", "--nftId"],
    ["priceRange", "--priceRange"],
    ["slippageBps", "--slippageBps"],
  ]) {
    if (intent[key] != null) args.push(flag, String(intent[key]));
  }
  args.push("--json");
  return args;
}

function materialProductFingerprint(info) {
  const assets = Array.isArray(info.assetTokenList)
    ? info.assetTokenList.map((item) => ({
      address: String(item?.tokenAddress ?? "").toLowerCase(),
      symbol: String(item?.tokenSymbol ?? item?.tokenName ?? "").toUpperCase(),
    })).sort((a, b) => a.address.localeCompare(b.address))
    : [];
  return digest({
    investmentId: String(info.investmentId ?? ""),
    defiProtocolId: String(info.defiProtocolId ?? ""),
    binanceChainId: String(info.binanceChainId ?? ""),
    protocolName: String(info.protocolName ?? ""),
    investType: String(info.investType ?? ""),
    investable: info.investable === true,
    assets,
    poolAddress: String(info.poolAddress ?? "").toLowerCase(),
  });
}

function validateProduct(info, intent) {
  if (!info || typeof info !== "object") throw new Error("Investment metadata missing; action blocked.");
  if (String(info.investmentId ?? "") !== intent.investmentId) throw new Error("Investment ID does not match live BAW metadata.");
  if (!chainIsBsc(info.binanceChainId)) throw new Error("Investment is not verified for BNB Smart Chain (chain ID 56).");
  const protocolName = String(info.protocolName ?? "");
  const protocolId = String(info.defiProtocolId ?? "");
  if (!protocolName || !protocolId) throw new Error("Protocol metadata is incomplete; action blocked.");
  if (intent.defiProtocolId && intent.defiProtocolId !== protocolId) throw new Error("Protocol ID changed; create a new preview.");
  const expectedType = (intent.action === "deposit" || intent.action === "redeem") ? "Earn" : "LiquidityPool";
  if (String(info.investType ?? "").toLowerCase() !== expectedType.toLowerCase()) {
    throw new Error("Investment type does not match the requested action.");
  }
  if ((intent.action === "deposit" || intent.action === "redeem") && !/venus/i.test(protocolName)) {
    throw new Error("Earn execution is currently restricted to a live Venus product.");
  }
  if ((intent.action === "lp-add" || intent.action === "lp-remove") && !/pancake/i.test(protocolName)) {
    throw new Error("LP execution is currently restricted to a live PancakeSwap product.");
  }
  if ((intent.action === "deposit" || intent.action === "lp-add") && info.investable !== true) {
    throw new Error("This investment is not currently marked investable by BAW.");
  }
  const assets = Array.isArray(info.assetTokenList) ? info.assetTokenList : [];
  const assetAddresses = assets.map((item) => String(item?.tokenAddress ?? "").toLowerCase());
  if (!assetAddresses.length || assetAddresses.some((address) => !SAFE_TOKEN_SET.has(address))) {
    throw new Error("Product assets are missing or include an asset outside the fixed allowlist.");
  }
  if (intent.tokenAddress && !assetAddresses.includes(intent.tokenAddress.toLowerCase())) {
    throw new Error("Selected token is not part of this live investment product.");
  }
  if ((intent.action === "deposit" || intent.action === "redeem") &&
      !assetAddresses.includes(SAFE_BSC_TOKENS.USDT.toLowerCase())) {
    throw new Error("Live Venus metadata does not list the approved USDT token.");
  }
  return Object.freeze({ ...intent, defiProtocolId: protocolId });
}

function validatePreview(preview) {
  if (!preview || typeof preview !== "object" || !Array.isArray(preview.balanceChange) || preview.balanceChange.length === 0) {
    throw new Error("BAW preview is missing balance changes; execution blocked.");
  }
  const fee = preview.feeAndContract?.estimatedNetworkFee;
  const contractAddress = preview.feeAndContract?.interactWith?.address;
  if (!fee || !/^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/.test(String(fee.amount ?? "")) ||
      String(fee.tokenSymbol ?? "").toUpperCase() !== "BNB" || !ADDRESS.test(String(contractAddress ?? ""))) {
    throw new Error("BAW preview is missing a valid BNB fee or contract address; execution blocked.");
  }
  if (!Array.isArray(preview.warnings)) {
    throw new Error("BAW preview warnings are missing; execution blocked.");
  }
  for (const change of preview.balanceChange) {
    if (!change || typeof change !== "object" ||
        typeof change.tokenSymbol !== "string" || !change.tokenSymbol.trim() ||
        !/^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$/.test(String(change.amount ?? ""))) {
      throw new Error("BAW preview has an invalid balance change; execution blocked.");
    }
  }
  return preview;
}

function assertReceipt(receipt, txHash) {
  if (!receipt || typeof receipt !== "object") return "PENDING";
  if (String(receipt.transactionHash ?? "").toLowerCase() !== txHash.toLowerCase()) return "RECEIPT_HASH_MISMATCH";
  if (!/^0x[0-9a-f]+$/i.test(String(receipt.blockNumber ?? ""))) return "RECEIPT_NOT_MINED";
  if (!Number.isSafeInteger(Number(receipt.confirmations)) || Number(receipt.confirmations) < 3) return "CONFIRMING_ON_CHAIN";
  const status = receipt.status;
  if (status === "0x1" || status === 1 || status === 1n) return "CONFIRMED_SUCCESS";
  if (status === "0x0" || status === 0 || status === 0n) return "CONFIRMED_REVERTED";
  return "RECEIPT_STATUS_UNKNOWN";
}

/**
 * Local in-process preview/approval gate. runner must use execFile with an argv
 * array (never a shell). The caller must keep this module off all public routes.
 */
export function createLocalExecutionGate({
  runner,
  receiptReader,
  chainReader = readBscChainId,
  now = () => Date.now(),
  ttlMs = TTL_MS,
  receiptPollAttempts = 15,
  receiptPollIntervalMs = 2000,
  sleepImpl = sleep,
} = {}) {
  if (typeof runner !== "function") throw new Error("A local BAW runner is required.");
  if (typeof receiptReader !== "function") throw new Error("A BNB receipt reader is required.");
  if (typeof chainReader !== "function") throw new Error("A BNB chain reader is required.");
  const previews = new Map();
  const used = new Set();

  async function getProduct(investmentId) {
    const result = await runner(["defi", "investment-info", "--investmentId", investmentId, "--json"]);
    return unwrap(result);
  }

  return {
    async preview(input) {
      const rawIntent = normalizeLocalExecutionIntent(input);
      const network = await chainReader();
      if (!chainIsBsc(network)) throw new Error("Configured RPC did not report BNB Smart Chain chain ID 56.");
      const info = await getProduct(rawIntent.investmentId);
      const intent = validateProduct(info, rawIntent);
      const result = await runner(commandArgs(intent, "preview", info));
      const preview = validatePreview(unwrap(result));
      const previewId = crypto.randomBytes(24).toString("hex");
      const expiresAt = now() + ttlMs;
      const approvalDigest = digest({ intent, productFingerprint: materialProductFingerprint(info), preview, expiresAt });
      previews.set(previewId, { intent, productFingerprint: materialProductFingerprint(info), preview, expiresAt, approvalDigest });
      return {
        previewId,
        approvalDigest,
        expiresAt,
        intent,
        product: {
          investmentId: info.investmentId,
          investmentName: info.investmentName ?? null,
          protocolName: info.protocolName,
          defiProtocolId: info.defiProtocolId,
          binanceChainId: info.binanceChainId,
          investType: info.investType,
        },
        preview,
        executionEnabled: false,
      };
    },

    async execute({ previewId, approvalDigest, confirm } = {}) {
      if (confirm !== true) throw new Error("Explicit confirmation is required.");
      const id = String(previewId ?? "");
      const p = previews.get(id);
      if (!p || used.has(id)) throw new Error("Preview missing or already used.");
      if (now() >= p.expiresAt) {
        previews.delete(id);
        throw new Error("Preview expired; create a new one.");
      }
      if (typeof approvalDigest !== "string" || !/^[a-f0-9]{64}$/.test(approvalDigest) ||
          !crypto.timingSafeEqual(Buffer.from(approvalDigest, "hex"), Buffer.from(p.approvalDigest, "hex"))) {
        throw new Error("Approval does not match the exact preview.");
      }

      // Consume first. If anything below times out, this preview can never be replayed.
      previews.delete(id);
      used.add(id);
      try {
        const network = await chainReader();
        if (!chainIsBsc(network)) return { ok: false, state: "NETWORK_CHANGED", retryAllowed: false };
        const freshInfo = await getProduct(p.intent.investmentId);
        const freshIntent = validateProduct(freshInfo, p.intent);
        if (materialProductFingerprint(freshInfo) !== p.productFingerprint ||
            freshIntent.defiProtocolId !== p.intent.defiProtocolId) {
          return { ok: false, state: "PRODUCT_CHANGED_NEW_PREVIEW_REQUIRED", retryAllowed: false };
        }
      } catch {
        return { ok: false, state: "PREFLIGHT_FAILED_NO_EXECUTION", retryAllowed: false };
      }

      let result;
      try {
        result = await runner(commandArgs(p.intent, "execute"));
      } catch {
        return { ok: false, state: "EXECUTION_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY", retryAllowed: false };
      }
      if (result?.success !== true) {
        return { ok: false, state: "EXECUTION_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY", retryAllowed: false };
      }
      const txHash = result?.data?.txHash ?? result?.data?.transactionHash ?? result?.txHash;
      if (typeof txHash !== "string" || !TX_HASH.test(txHash)) {
        return { ok: false, state: "SUBMITTED_UNVERIFIED_RECONCILE_BEFORE_RETRY", retryAllowed: false };
      }
      let lastReceipt = null;
      for (let attempt = 0; attempt < receiptPollAttempts; attempt += 1) {
        let receipt;
        try { receipt = await receiptReader(txHash); } catch {
          return { ok: false, state: "PENDING_VERIFICATION", txHash, retryAllowed: false };
        }
        if (receipt) {
          const state = assertReceipt(receipt, txHash);
          lastReceipt = receipt;
          if (state === "CONFIRMING_ON_CHAIN" && attempt + 1 < receiptPollAttempts) {
            await sleepImpl(receiptPollIntervalMs);
            continue;
          }
          if (state === "CONFIRMING_ON_CHAIN") {
            return {
              ok: false, state, txHash,
              receipt: { status: receipt.status ?? null, blockNumber: receipt.blockNumber ?? null, confirmations: receipt.confirmations ?? 0 },
              chainId: CHAIN_ID, retryAllowed: false,
            };
          }
          return {
            ok: state === "CONFIRMED_SUCCESS",
            state,
            txHash,
            receipt: { status: receipt.status ?? null, blockNumber: receipt.blockNumber ?? null, confirmations: receipt.confirmations ?? null },
            chainId: CHAIN_ID,
            retryAllowed: false,
          };
        }
        if (attempt + 1 < receiptPollAttempts) await sleepImpl(receiptPollIntervalMs);
      }
      return lastReceipt
        ? { ok: false, state: "CONFIRMING_ON_CHAIN", txHash, receipt: { status: lastReceipt.status ?? null, blockNumber: lastReceipt.blockNumber ?? null, confirmations: lastReceipt.confirmations ?? 0 }, chainId: CHAIN_ID, retryAllowed: false }
        : { ok: false, state: "SUBMITTED_PENDING_RECEIPT", txHash, retryAllowed: false };
    },
  };
}

async function rpcCall(method, params = [], {
  rpcUrl = process.env.PHOVEUS_BSC_RPC_URL || "https://bsc-dataseed.binance.org/",
  fetchImpl = fetch,
} = {}) {
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "https:") throw new Error("BSC RPC must use HTTPS.");
  const response = await fetchImpl(parsed.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("BNB Chain RPC unavailable.");
  const body = await response.json();
  if (!body || body.error || !Object.hasOwn(body, "result")) throw new Error("Invalid BNB Chain RPC response.");
  return body.result;
}

export async function readBscChainId(options = {}) {
  const chainId = await rpcCall("eth_chainId", [], options);
  if (String(chainId).toLowerCase() !== "0x38" && String(chainId) !== CHAIN_ID) {
    throw new Error("Configured RPC is not BNB Smart Chain.");
  }
  return CHAIN_ID;
}

export async function readBscReceipt(txHash, options = {}) {
  if (!TX_HASH.test(String(txHash))) throw new Error("Invalid transaction hash.");
  await readBscChainId(options);
  const receipt = await rpcCall("eth_getTransactionReceipt", [txHash], options);
  if (receipt == null) return null;
  if (String(receipt.transactionHash ?? "").toLowerCase() !== txHash.toLowerCase()) {
    throw new Error("BNB Chain receipt hash does not match the requested transaction.");
  }
  if (!/^0x[0-9a-f]+$/i.test(String(receipt.blockNumber ?? ""))) {
    throw new Error("BNB Chain receipt has no valid mined block.");
  }
  const latestBlock = await rpcCall("eth_blockNumber", [], options);
  if (!/^0x[0-9a-f]+$/i.test(String(latestBlock ?? ""))) throw new Error("BNB Chain head block response is invalid.");
  const confirmations = BigInt(latestBlock) - BigInt(receipt.blockNumber) + 1n;
  return { ...receipt, confirmations: confirmations > 0n && confirmations <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(confirmations) : 0 };
}

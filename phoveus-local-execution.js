import crypto from "node:crypto";

const CHAIN_ID = "56";
const TTL_MS = 60_000;
const HASH = /^0x[a-fA-F0-9]{64}$/;
const PRODUCTS = Object.freeze({
  "venus-usdt": { protocol: "venus", id: "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb", token: "0x55d398326f99059ff775485246999027b3197955", actions: ["deposit", "redeem"] },
  "pancakeswap-infinity-cake-usdt": { protocol: "pancakeswap4", id: "d31aa56a981440427cc25f1ae285c99cfa59ac0a2e5b99afab516c460f682f36", token: "0x55d398326f99059ff775485246999027b3197955", actions: ["lp-add", "lp-remove"] },
});

function amount(v) {
  const s = String(v ?? "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(s) || Number(s) <= 0) throw new Error("Invalid positive amount.");
  return s;
}
function integer(v, max = 1_000_000_000) {
  const s = String(v ?? "");
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error("Invalid positive integer.");
  return s;
}
function ratio(v) {
  const s = String(v ?? "");
  const n = Number(s);
  if (!/^(?:0?\.\d+|1(?:\.0+)?)$/.test(s) || n <= 0 || n > 1) throw new Error("Invalid ratio.");
  return s;
}
function slippage(v = "auto") {
  const s = String(v);
  if (s !== "auto" && (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 4999)) throw new Error("Invalid slippage.");
  return s;
}
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function hash(v) {
  return crypto.createHash("sha256").update(canonical(v)).digest("hex");
}

export function normalizeLocalExecutionIntent(input) {
  const venue = String(input?.venue || "");
  const action = String(input?.action || "");
  const p = PRODUCTS[venue];
  if (!p || !p.actions.includes(action)) throw new Error("Unsupported venue/action.");
  const i = { chainId: CHAIN_ID, venue, action, protocol: p.protocol, investmentId: p.id };
  if (action === "deposit") {
    i.tokenAddress = p.token;
    i.amount = amount(input.amount);
  } else if (action === "redeem") {
    if (input.amount != null && input.amount !== "") i.amount = amount(input.amount);
    else i.ratio = ratio(input.ratio);
    if (i.amount) i.tokenAddress = p.token;
  } else if (action === "lp-add") {
    i.tokenAddress = p.token;
    i.amount = amount(input.amount);
    i.priceRange = integer(input.priceRange, 100);
    i.slippageBps = slippage(input.slippageBps);
  } else {
    i.nftId = integer(input.nftId);
    i.ratio = ratio(input.ratio);
    i.slippageBps = slippage(input.slippageBps);
  }
  return Object.freeze(i);
}

function argsFor(i, phase) {
  const a = ["defi", phase, "--action", i.action, "--investmentId", i.investmentId, "--defiProtocolId", i.protocol, "--binanceChainId", i.chainId];
  for (const [key, flag] of [["tokenAddress", "--tokenAddress"], ["amount", "--amount"], ["ratio", "--ratio"], ["priceRange", "--priceRange"], ["slippageBps", "--slippageBps"], ["nftId", "--nftId"]]) {
    if (i[key] != null) a.push(flag, String(i[key]));
  }
  a.push("--json");
  return a;
}

/**
 * Local in-process approval gate. runner must call the BAW CLI via execFile
 * using args as an argv array. No HTTP endpoint or public route is provided.
 */
export function createLocalExecutionGate({ runner, receiptReader, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
  if (typeof runner !== "function") throw new Error("A local BAW runner is required.");
  if (typeof receiptReader !== "function") throw new Error("A BNB receipt reader is required.");
  const previews = new Map();
  const used = new Set();

  return {
    async preview(input) {
      const intent = normalizeLocalExecutionIntent(input);
      const result = await runner(argsFor(intent, "preview"));
      if (result?.success !== true) throw new Error("Preview failed; execution remains disabled.");
      const preview = result.data ?? result;
      const previewId = crypto.randomBytes(24).toString("hex");
      const expiresAt = now() + ttlMs;
      const approvalDigest = hash({ intent, preview, expiresAt });
      previews.set(previewId, { intent, preview, expiresAt, approvalDigest });
      return { previewId, approvalDigest, expiresAt, intent, preview, executionEnabled: false };
    },

    async execute({ previewId, approvalDigest, confirm } = {}) {
      if (confirm !== true) throw new Error("Explicit confirmation is required.");
      const p = previews.get(String(previewId || ""));
      if (!p || used.has(previewId)) throw new Error("Preview missing or already used.");
      if (now() > p.expiresAt) {
        previews.delete(previewId);
        throw new Error("Preview expired; create a new one.");
      }
      if (typeof approvalDigest !== "string" || !/^[a-f0-9]{64}$/.test(approvalDigest) || !crypto.timingSafeEqual(Buffer.from(approvalDigest), Buffer.from(p.approvalDigest))) {
        throw new Error("Approval does not match the exact preview.");
      }
      // Consume before calling the transaction command; never blind-retry.
      previews.delete(previewId);
      used.add(previewId);
      const result = await runner(argsFor(p.intent, p.intent.action));
      if (result?.success !== true) return { ok: false, state: "EXECUTION_UNKNOWN_OR_FAILED", retryAllowed: false };
      const txHash = result?.data?.txHash ?? result?.data?.transactionHash ?? result?.txHash;
      if (typeof txHash !== "string" || !HASH.test(txHash)) return { ok: false, state: "SUBMITTED_UNVERIFIED", retryAllowed: false };
      let receipt;
      try { receipt = await receiptReader(txHash); } catch { return { ok: false, state: "PENDING_VERIFICATION", txHash, retryAllowed: false }; }
      if (!receipt) return { ok: false, state: "PENDING", txHash, retryAllowed: false };
      const ok = receipt.status === "0x1" || receipt.status === 1 || receipt.status === 1n;
      const reverted = receipt.status === "0x0" || receipt.status === 0 || receipt.status === 0n;
      return {
        ok,
        state: ok ? "CONFIRMED_SUCCESS" : reverted ? "CONFIRMED_REVERTED" : "RECEIPT_STATUS_UNKNOWN",
        txHash,
        receipt: { status: receipt.status, blockNumber: receipt.blockNumber ?? null },
        chainId: CHAIN_ID,
        retryAllowed: false,
      };
    },
  };
}

export async function readBscReceipt(txHash, { rpcUrl = process.env.PHOVEUS_BSC_RPC_URL || "https://bsc-dataseed.binance.org/", fetchImpl = fetch } = {}) {
  if (!HASH.test(String(txHash))) throw new Error("Invalid transaction hash.");
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("BNB Chain RPC unavailable.");
  const body = await response.json();
  if (body?.error || !body || !Object.hasOwn(body, "result")) throw new Error("Invalid receipt response.");
  return body.result;
}

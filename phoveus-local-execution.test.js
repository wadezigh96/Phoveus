import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalExecutionGate,
  normalizeLocalExecutionIntent,
  readBscChainId,
  readBscReceipt,
  SAFE_BSC_TOKENS,
} from "./phoveus-local-execution.js";

const TX_HASH = "0x" + "a".repeat(64);
const INVESTMENT_ID = "a12b34cdef5678901234567890abcdef";
const PROTOCOL_ID = "venus_usdt_core_pool";
const product = () => ({
  investmentId: INVESTMENT_ID,
  investmentName: "USDT Earn",
  defiProtocolId: PROTOCOL_ID,
  protocolName: "Venus Core Pool",
  binanceChainId: "56",
  investType: "Earn",
  investable: true,
  assetTokenList: [{ tokenAddress: SAFE_BSC_TOKENS.USDT, tokenSymbol: "USDT" }],
});

function setup({
  ttlMs = 60000,
  receipt = { transactionHash: TX_HASH, status: "0x1", blockNumber: "0x10", confirmations: 3 },
  chainId = "56",
  changeProductAtSecondRead = false,
  transactionError = false,
  incompletePreview = false,
} = {}) {
  let clock = 1000;
  let infoReads = 0;
  const calls = [];
  const gate = createLocalExecutionGate({
    now: () => clock,
    ttlMs,
    receiptPollAttempts: 1,
    sleepImpl: async () => {},
    chainReader: async () => chainId,
    runner: async (args) => {
      calls.push([...args]);
      if (args[0] === "defi" && args[1] === "investment-info") {
        infoReads += 1;
        const info = product();
        if (changeProductAtSecondRead && infoReads >= 2) info.protocolName = "Changed Protocol";
        return { success: true, data: info };
      }
      if (args[0] === "defi" && args[1] === "preview") {
        return incompletePreview
          ? { success: true, data: { warnings: [] } }
          : {
            success: true,
            data: {
              balanceChange: [{ tokenSymbol: "USDT", tokenAddress: SAFE_BSC_TOKENS.USDT, amount: "-1" }],
              feeAndContract: { estimatedNetworkFee: { amount: "0.001", tokenSymbol: "BNB" }, interactWith: { address: "0x" + "b".repeat(40) } },
              warnings: [],
            },
          };
      }
      if (transactionError) throw new Error("mock timeout");
      return { success: true, data: { txHash: TX_HASH } };
    },
    receiptReader: async () => receipt,
  });
  return { gate, calls, advance: (ms) => { clock += ms; } };
}

const depositIntent = (extra = {}) => ({
  action: "deposit",
  investmentId: INVESTMENT_ID,
  tokenAddress: SAFE_BSC_TOKENS.USDT,
  amount: "1.25",
  ...extra,
});

test("requires a live investment ID, BSC USDT, and a valid action", () => {
  const intent = normalizeLocalExecutionIntent(depositIntent());
  assert.equal(intent.chainId, "56");
  assert.equal(intent.investmentId, INVESTMENT_ID);
  assert.equal(intent.amount, "1.25");
  assert.equal(intent.tokenAddress, SAFE_BSC_TOKENS.USDT);
  assert.throws(() => normalizeLocalExecutionIntent(depositIntent({ amount: "1; baw wallet send" })));
  assert.throws(() => normalizeLocalExecutionIntent(depositIntent({ tokenAddress: "0x" + "1".repeat(40) })), /allowlist/);
  assert.throws(() => normalizeLocalExecutionIntent({ ...depositIntent(), investmentId: "x; rm -rf /" }));
  assert.throws(() => normalizeLocalExecutionIntent({ ...depositIntent(), action: "wallet-send" }), /Unsupported action/);
});

test("rejects bad and zero redeem ratios", () => {
  assert.throws(() => normalizeLocalExecutionIntent({
    action: "redeem", investmentId: INVESTMENT_ID, tokenAddress: SAFE_BSC_TOKENS.USDT, amount: "1", ratio: "0.5",
  }), /exactly one/);
  assert.throws(() => normalizeLocalExecutionIntent({
    action: "redeem", investmentId: INVESTMENT_ID, tokenAddress: SAFE_BSC_TOKENS.USDT, ratio: "0",
  }), /ratio/);
  assert.throws(() => normalizeLocalExecutionIntent({
    action: "redeem", investmentId: INVESTMENT_ID, tokenAddress: SAFE_BSC_TOKENS.USDT, ratio: "1.1",
  }), /ratio/);
});

test("constructs documented preview and execution commands with no guessed product IDs", async () => {
  const { gate, calls } = setup();
  const preview = await gate.preview(depositIntent());
  const previewCall = calls.find((args) => args[1] === "preview");
  assert.deepEqual(previewCall.slice(0, 8), [
    "defi", "preview", "--action", "DEPOSIT", "--investmentId", INVESTMENT_ID,
    "--defiProtocolId", PROTOCOL_ID,
  ].slice(0, 8));
  assert.ok(previewCall.includes("--binanceChainId"));
  assert.ok(previewCall.includes("56"));
  assert.ok(previewCall.includes("--tokenAddress"));
  assert.ok(previewCall.includes("--amount"));
  assert.equal(preview.executionEnabled, false);

  const result = await gate.execute({ previewId: preview.previewId, approvalDigest: preview.approvalDigest, confirm: true });
  assert.equal(result.state, "CONFIRMED_SUCCESS");
  assert.equal(result.txHash, TX_HASH);
  const executeCall = calls.at(-1);
  assert.deepEqual(executeCall.slice(0, 3), ["defi", "deposit", "--investmentId"]);
  assert.ok(!executeCall.includes("--action"));
  assert.ok(!executeCall.includes("--binanceChainId"));
  assert.ok(executeCall.includes(INVESTMENT_ID));
  assert.ok(executeCall.includes(SAFE_BSC_TOKENS.USDT));
  assert.ok(!executeCall.includes("--defiProtocolId"));
});

test("rejects successful-but-incomplete preview responses", async () => {
  const { gate, calls } = setup({ incompletePreview: true });
  await assert.rejects(gate.preview(depositIntent()), /missing balance changes/);
  assert.equal(calls.filter((args) => args[1] === "deposit").length, 0);
});

test("requires explicit confirmation and exact preview digest", async () => {
  const { gate, calls } = setup();
  const p = await gate.preview(depositIntent());
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest }), /Explicit confirmation/);
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: "0".repeat(64), confirm: true }), /exact preview/);
  assert.equal(calls.filter((args) => args[1] === "deposit").length, 0);
});

test("consumes a preview once and rejects replay", async () => {
  const { gate } = setup();
  const p = await gate.preview(depositIntent());
  const first = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(first.state, "CONFIRMED_SUCCESS");
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true }), /missing or already used/);
});

test("expired preview is never executed", async () => {
  const { gate, calls, advance } = setup({ ttlMs: 10 });
  const p = await gate.preview(depositIntent());
  advance(10);
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true }), /expired/);
  assert.equal(calls.filter((args) => args[1] === "deposit").length, 0);
});

test("changed live product after preview invalidates execution", async () => {
  const { gate, calls } = setup({ changeProductAtSecondRead: true });
  const p = await gate.preview(depositIntent());
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "PREFLIGHT_FAILED_NO_EXECUTION");
  assert.equal(calls.filter((args) => args[1] === "deposit").length, 0);
});

test("wrong RPC chain blocks before any BAW command", async () => {
  const { gate, calls } = setup({ chainId: "1" });
  await assert.rejects(gate.preview(depositIntent()), /chain ID 56/);
  assert.equal(calls.length, 0);
});

test("unknown execution result is never automatically retried", async () => {
  const { gate, calls } = setup({ transactionError: true });
  const p = await gate.preview(depositIntent());
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "EXECUTION_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY");
  assert.equal(result.retryAllowed, false);
  assert.equal(calls.filter((args) => args[1] === "deposit").length, 1);
});

test("missing receipt remains pending and a mismatched receipt hash is rejected", async () => {
  const pendingSetup = setup({ receipt: null });
  const p = await pendingSetup.gate.preview(depositIntent());
  const pending = await pendingSetup.gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(pending.state, "SUBMITTED_PENDING_RECEIPT");
  assert.equal(pending.retryAllowed, false);

  const mismatchedSetup = setup({ receipt: { transactionHash: "0x" + "c".repeat(64), status: "0x1", blockNumber: "0x10", confirmations: 3 } });
  const p2 = await mismatchedSetup.gate.preview(depositIntent());
  const mismatch = await mismatchedSetup.gate.execute({ previewId: p2.previewId, approvalDigest: p2.approvalDigest, confirm: true });
  assert.equal(mismatch.state, "RECEIPT_HASH_MISMATCH");
  assert.equal(mismatch.ok, false);
});

test("waits for three block confirmations before reporting success", async () => {
  const { gate } = setup({ receipt: { transactionHash: TX_HASH, status: "0x1", blockNumber: "0x10", confirmations: 1 } });
  const p = await gate.preview(depositIntent());
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "CONFIRMING_ON_CHAIN");
  assert.equal(result.ok, false);
});

test("reverted receipt is not reported as success", async () => {
  const { gate } = setup({ receipt: { transactionHash: TX_HASH, status: "0x0", blockNumber: "0x11", confirmations: 3 } });
  const p = await gate.preview(depositIntent());
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "CONFIRMED_REVERTED");
  assert.equal(result.ok, false);
  assert.equal(result.retryAllowed, false);
});

test("LP parameters require exactly one valid source and enforce bounds", () => {
  const common = { action: "lp-add", investmentId: INVESTMENT_ID, tokenAddress: SAFE_BSC_TOKENS.CAKE, amount: "1" };
  assert.throws(() => normalizeLocalExecutionIntent(common), /exactly one/);
  assert.throws(() => normalizeLocalExecutionIntent({ ...common, priceRange: "101" }), /integer/);
  assert.throws(() => normalizeLocalExecutionIntent({ ...common, priceRange: "5", nftId: "123" }), /exactly one/);
  const add = normalizeLocalExecutionIntent({ ...common, priceRange: "5", slippageBps: "100" });
  assert.equal(add.priceRange, "5");
  const remove = normalizeLocalExecutionIntent({
    action: "lp-remove", investmentId: INVESTMENT_ID, nftId: "123", ratio: "1", slippageBps: "100",
  });
  assert.equal(remove.nftId, "123");
});

test("read-only RPC helpers validate chain, receipt hash, and HTTP failures", async () => {
  const okFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => request.method === "eth_chainId"
        ? { jsonrpc: "2.0", id: 1, result: "0x38" }
        : request.method === "eth_getTransactionReceipt"
          ? { jsonrpc: "2.0", id: 1, result: { transactionHash: TX_HASH, status: "0x1", blockNumber: "0x10" } }
          : { jsonrpc: "2.0", id: 1, result: "0x12" },
    };
  };
  assert.equal(await readBscChainId({ fetchImpl: okFetch, rpcUrl: "https://bsc.example/" }), "56");
  assert.equal((await readBscReceipt(TX_HASH, { fetchImpl: okFetch, rpcUrl: "https://bsc.example/" })).transactionHash, TX_HASH);
  await assert.rejects(readBscChainId({ fetchImpl: okFetch, rpcUrl: "http://bsc.example/" }), /HTTPS/);
  const badFetch = async () => ({ ok: true, json: async () => ({ result: "0x1" }) });
  await assert.rejects(readBscChainId({ fetchImpl: badFetch, rpcUrl: "https://bad.example/" }), /not BNB Smart Chain/);
});

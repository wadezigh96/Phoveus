import test from "node:test";
import assert from "node:assert/strict";
import { createLocalExecutionGate, normalizeLocalExecutionIntent } from "./phoveus-local-execution.js";

function setup({ ttlMs = 60000, receipt = { status: "0x1", blockNumber: "0x10" } } = {}) {
  let clock = 1000;
  const calls = [];
  const gate = createLocalExecutionGate({
    now: () => clock,
    ttlMs,
    runner: async (args) => {
      calls.push(args);
      return args[1] === "preview"
        ? { success: true, data: { fees: "0.001 BNB", balanceChanges: ["USDT -1"], warnings: [] } }
        : { success: true, data: { txHash: "0x" + "a".repeat(64) } };
    },
    receiptReader: async () => receipt,
  });
  return { gate, calls, advance: (ms) => { clock += ms; } };
}

test("intent pins chain, product, token and amount; rejects arbitrary input", () => {
  const intent = normalizeLocalExecutionIntent({ venue: "venus-usdt", action: "deposit", amount: "1.25" });
  assert.equal(intent.chainId, "56");
  assert.equal(intent.amount, "1.25");
  assert.equal(intent.tokenAddress, "0x55d398326f99059ff775485246999027b3197955");
  assert.throws(() => normalizeLocalExecutionIntent({ venue: "venus-usdt", action: "deposit", amount: "1; baw wallet send" }));
  assert.throws(() => normalizeLocalExecutionIntent({ venue: "unlisted", action: "deposit", amount: "1" }));
});

test("requires explicit confirmation and the exact preview digest", async () => {
  const { gate, calls } = setup();
  const p = await gate.preview({ venue: "venus-usdt", action: "deposit", amount: "1" });
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest }), /Explicit confirmation/);
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: "0".repeat(64), confirm: true }), /exact preview/);
  assert.equal(calls.length, 1);
});

test("executes once and requires successful receipt verification", async () => {
  const { gate, calls } = setup();
  const p = await gate.preview({ venue: "venus-usdt", action: "deposit", amount: "1" });
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "CONFIRMED_SUCCESS");
  assert.equal(result.txHash, "0x" + "a".repeat(64));
  assert.equal(calls.length, 2);
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true }), /missing or already used/);
});

test("rejects expired previews without executing", async () => {
  const { gate, calls, advance } = setup({ ttlMs: 10 });
  const p = await gate.preview({ venue: "venus-usdt", action: "deposit", amount: "1" });
  advance(11);
  await assert.rejects(gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true }), /expired/);
  assert.equal(calls.length, 1);
});

test("reverted receipt is not reported as success and cannot be blindly retried", async () => {
  const { gate } = setup({ receipt: { status: "0x0", blockNumber: "0x11" } });
  const p = await gate.preview({ venue: "venus-usdt", action: "deposit", amount: "2" });
  const result = await gate.execute({ previewId: p.previewId, approvalDigest: p.approvalDigest, confirm: true });
  assert.equal(result.state, "CONFIRMED_REVERTED");
  assert.equal(result.ok, false);
  assert.equal(result.retryAllowed, false);
});

test("LP and redeem parameters are required and validated", () => {
  assert.throws(() => normalizeLocalExecutionIntent({ venue: "pancakeswap-infinity-cake-usdt", action: "lp-remove", ratio: "1" }), /integer/);
  assert.throws(() => normalizeLocalExecutionIntent({ venue: "pancakeswap-infinity-cake-usdt", action: "lp-add", amount: "1", priceRange: "101" }), /integer/);
  assert.equal(normalizeLocalExecutionIntent({ venue: "pancakeswap-infinity-cake-usdt", action: "lp-remove", nftId: "123", ratio: "1", slippageBps: "100" }).nftId, "123");
});

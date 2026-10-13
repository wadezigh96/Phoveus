import test from "node:test";
import assert from "node:assert/strict";
import { resolveDefiTask, runDefiTask } from "./task-router.js";

test("routes PancakeSwap staking request to PancakeSwap and CMC", () => {
  assert.deepEqual(resolveDefiTask({ message: "I want staking on PancakeSwap", cmcSymbol: "CAKE" }), {
    protocol: "pancakeswap",
    action: "stake",
    cmcSymbol: "CAKE",
    amountBnb: null,
  });
});

test("routes Venus deposit to Venus, not PancakeSwap", () => {
  assert.equal(resolveDefiTask({ message: "deposit on Venus", amountBnb: "0.01" }).protocol, "venus");
  assert.equal(resolveDefiTask({ message: "deposit on Venus", amountBnb: "0.01" }).action, "deposit");
});

test("rejects ambiguous protocol instead of guessing", () => {
  assert.throws(() => resolveDefiTask({ message: "stake some tokens" }), /Specify Venus or PancakeSwap/);
});

test("keeps execution locked and returns partial source failures", async () => {
  const report = await runDefiTask(
    { message: "staking on PancakeSwap", cmcSymbol: "CAKE" },
    {
      getCmcQuote: async () => ({ ok: true, symbol: "CAKE" }),
      readPancakeSwapBscPools: async () => { throw new Error("offline"); },
      readVenusBnbMarket: async () => ({}),
      readVenusUsdtEarn: async () => ({}),
      assessVenusDeposit: () => ({}),
      venusMarketAddress: "0x0000000000000000000000000000000000000001",
    },
  );
  assert.equal(report.sources.cmc.status, "ok");
  assert.equal(report.sources.pancakeswap.status, "unavailable");
  assert.equal(report.executionLocked, true);
  assert.equal(report.executionAllowed, false);
  assert.equal(report.orderForwarded, false);
  assert.equal(report.transactionBuilt, false);
});

test("Venus deposit assessment cannot unlock execution", async () => {
  const report = await runDefiTask(
    { protocol: "venus", action: "deposit", amountBnb: "0.01" },
    {
      getCmcQuote: async () => ({}),
      readVenusBnbMarket: async () => ({}),
      readVenusUsdtEarn: async () => ({}),
      readPancakeSwapBscPools: async () => ({}),
      assessVenusDeposit: () => ({ executionAllowed: false, mode: "simulation-only" }),
      venusMarketAddress: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
    },
  );
  assert.equal(report.preflight.status, "assessment_only");
  assert.equal(report.executionLocked, true);
  assert.equal(report.preflight.executionAllowed, false);
});

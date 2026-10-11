import test from "node:test";
import assert from "node:assert/strict";
import { assessVenusDeposit } from "./agent-executor.js";

const valid = {
  amountBnb: "0.01",
  chainId: "56",
  marketAddress: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
};

test("valid deposit intent remains simulation-only", () => {
  const result = assessVenusDeposit(valid);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.transactionHash, null);
  assert.equal(result.checks.correctChain, true);
  assert.equal(result.checks.correctMarket, true);
});

test("rejects deposit above 0.01 BNB", () => {
  assert.throws(
    () => assessVenusDeposit({ ...valid, amountBnb: "0.010000000000000001" }),
    /0.01 BNB/
  );
});

test("rejects wrong chain and wrong market", () => {
  const result = assessVenusDeposit({
    ...valid,
    chainId: "97",
    marketAddress: "0x0000000000000000000000000000000000000001",
  });
  assert.equal(result.checks.correctChain, false);
  assert.equal(result.checks.correctMarket, false);
  assert.equal(result.executionAllowed, false);
});

test("never unlocks execution merely because approval and signer are claimed", () => {
  const result = assessVenusDeposit({
    ...valid,
    signerAvailable: true,
    explicitApproval: true,
    emergencyStop: false,
  });
  assert.equal(result.executionAllowed, false);
});

test("rejects zero and malformed amounts", () => {
  assert.throws(() => assessVenusDeposit({ ...valid, amountBnb: "0" }));
  assert.throws(() => assessVenusDeposit({ ...valid, amountBnb: "-1" }));
  assert.throws(() => assessVenusDeposit({ ...valid, amountBnb: "1e-3" }));
});

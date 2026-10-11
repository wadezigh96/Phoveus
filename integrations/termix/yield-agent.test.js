import test from "node:test";
import assert from "node:assert/strict";
import { analyzeYieldForTermix } from "./yield-agent.js";

test("TermiX adapter compares RWA yield with BNB APR read-only", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: { data: { dividendYield: "0.85" } },
    bnbFlexiblePayload: {
      data: {
        rows: [
          { asset: "BNB", latestAnnualPercentageRate: "0.05" }
        ]
      }
    }
  });

  assert.equal(result.marketplace, "TermiX");
  assert.equal(result.chainId, 56);
  assert.equal(result.result.rwaYieldPct, 0.85);
  assert.equal(result.result.bnbYieldPct, 5);
  assert.equal(result.result.spreadPct, -4.15);
  assert.equal(result.result.relation, "RWA_BELOW_BNB");
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.executionUnlocked, false);
});

test("TermiX adapter withholds spread when yield data is missing", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: {},
    bnbFlexiblePayload: { data: { rows: [] } }
  });

  assert.equal(result.result.spreadPct, null);
  assert.equal(result.result.relation, "INCOMPLETE");
  assert.equal(result.safety.executionUnlocked, false);
});

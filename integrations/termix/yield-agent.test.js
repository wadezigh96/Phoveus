import test from "node:test";
import assert from "node:assert/strict";
import { analyzeYieldForTermix } from "./yield-agent.js";

const flexiblePayload = (overrides = {}) => ({
  data: {
    list: [{
      asset: "BNB",
      productDetailList: [{
        productId: "BNB001",
        productType: "LENDING_FLEXIBLE",
        duration: "0",
        status: "ENABLE",
        apy: "0.00171665",
        marketApr: "0.00051665",
        ...overrides,
      }],
    }],
  },
});

test("TermiX adapter reads enabled BNB flexible APY read-only", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: { data: { dividendYield: "0.12" } },
    bnbFlexiblePayload: flexiblePayload(),
  });

  assert.equal(result.marketplace, "TermiX");
  assert.equal(result.chainId, 56);
  assert.equal(result.result.rwaYieldPct, 0.12);
  assert.equal(result.result.rwaYieldType, "UNDERLYING_STOCK_DIVIDEND_YIELD");
  assert.equal(result.result.bnbYieldPct, 0.1717);
  assert.equal(result.result.bnbYieldType, "APY");
  assert.equal(result.result.bnbProductId, "BNB001");
  assert.equal(result.result.spreadPct, -0.0517);
  assert.equal(result.result.relation, "RWA_BELOW_BNB");
  assert.equal(result.analysisStatus, "complete");
  assert.deepEqual(result.missingInputs, []);
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.executionUnlocked, false);
  assert.equal(result.safety.orderForwarded, false);
});

test("TermiX adapter withholds spread when either yield input is missing", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: {},
    bnbFlexiblePayload: { data: { list: [] } },
  });

  assert.equal(result.result.spreadPct, null);
  assert.equal(result.result.relation, "INCOMPLETE");
  assert.equal(result.analysisStatus, "incomplete");
  assert.deepEqual(result.missingInputs, ["rwaDividendYield", "bnbFlexibleApy"]);
  assert.equal(result.safety.executionUnlocked, false);
});

test("TermiX adapter rejects disabled flexible products", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: { data: { dividendYield: "0.12" } },
    bnbFlexiblePayload: flexiblePayload({ status: "DISABLE" }),
  });

  assert.equal(result.result.bnbYieldPct, null);
  assert.equal(result.result.spreadPct, null);
  assert.deepEqual(result.missingInputs, ["bnbFlexibleApy"]);
});

test("TermiX adapter does not substitute a fixed-term product", () => {
  const result = analyzeYieldForTermix({
    underlyingProfile: { data: { dividendYield: "0.12" } },
    bnbFlexiblePayload: flexiblePayload({
      productType: "LENDING_FIXED",
      duration: "30",
    }),
  });

  assert.equal(result.result.bnbYieldPct, null);
  assert.equal(result.result.spreadPct, null);
  assert.equal(result.analysisStatus, "incomplete");
});

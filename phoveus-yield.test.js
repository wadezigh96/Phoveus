import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRwaDividendYieldPct,
  parseBnbDecimalAprPct,
  readUnderlyingYield,
  readBnbFlexibleApr,
  compareRwaBnbYield,
} from "./phoveus-yield.js";

test("parseRwaDividendYieldPct accepts documented percent values", () => {
  assert.equal(parseRwaDividendYieldPct("0.85"), 0.85);
  assert.equal(parseRwaDividendYieldPct(1.23), 1.23);
  assert.equal(parseRwaDividendYieldPct(null), null);
  assert.equal(parseRwaDividendYieldPct(""), null);
  assert.equal(parseRwaDividendYieldPct(101), null);
  assert.equal(parseRwaDividendYieldPct(-1), null);
});

test("parseBnbDecimalAprPct converts decimal rate to percent", () => {
  assert.equal(parseBnbDecimalAprPct("0.05"), 5);
  assert.equal(parseBnbDecimalAprPct("0.04368921"), 4.3689);
  assert.equal(parseBnbDecimalAprPct(null), null);
  assert.equal(parseBnbDecimalAprPct(6), null); // >5 rejected as invalid
});

test("readUnderlyingYield extracts dividendYield as percent", () => {
  const profile = { data: { dividendYield: "0.85", latestDividend: "0.25" } };
  const out = readUnderlyingYield(profile);
  assert.equal(out.dividendYieldPct, 0.85);
  assert.equal(out.latestDividend, "0.25");
  assert.equal(out.unit, "percent");
});

test("readBnbFlexibleApr handles official SAPI rows shape", () => {
  const payload = {
    rows: [{ asset: "BNB", latestAnnualPercentageRate: "0.012345", productId: "BNB001" }],
    total: 1,
  };
  const out = readBnbFlexibleApr(payload);
  assert.equal(out.aprPct, 1.2345);
  assert.equal(out.productId, "BNB001");
  assert.equal(out.sourceField, "latestAnnualPercentageRate");
});

test("readBnbFlexibleApr handles public bapi data shape and latestAnnualInterestRate", () => {
  const payload = {
    data: [{ asset: "BNB", latestAnnualInterestRate: "0.02", id: "BNB999" }],
  };
  const out = readBnbFlexibleApr(payload);
  assert.equal(out.aprPct, 2);
  assert.equal(out.productId, "BNB999");
  assert.equal(out.sourceField, "latestAnnualInterestRate");
});

test("readBnbFlexibleApr returns null for empty or unexpected schema", () => {
  assert.equal(readBnbFlexibleApr({ data: [] }).aprPct, null);
  assert.equal(readBnbFlexibleApr({ rows: [{ asset: "BTC" }] }).aprPct, null);
  assert.equal(readBnbFlexibleApr(null).aprPct, null);
  assert.equal(readBnbFlexibleApr({ unexpected: true }).aprPct, null);
});

test("compareRwaBnbYield keeps INCOMPLETE when either side is missing", () => {
  const incomplete = compareRwaBnbYield({ rwaYieldPct: 0.85, bnbYieldPct: null });
  assert.equal(incomplete.relation, "INCOMPLETE");
  assert.equal(incomplete.spreadPct, null);

  const complete = compareRwaBnbYield({ rwaYieldPct: 1.2, bnbYieldPct: 0.5 });
  assert.equal(complete.relation, "RWA_ABOVE_BNB");
  assert.equal(complete.spreadPct, 0.7);
});

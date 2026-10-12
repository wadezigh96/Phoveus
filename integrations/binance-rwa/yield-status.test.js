import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRwaSource,
  classifyBnbSource,
  isRestrictedStatus,
} from "./yield-status.js";

test("classifyRwaSource distinguishes config-missing from restricted", () => {
  assert.equal(classifyRwaSource({ configured: false }), "config-missing");
  assert.equal(classifyRwaSource({ configured: true, restricted: true }), "restricted");
  assert.equal(classifyRwaSource({ configured: true, hasYield: true }), "binance-web3");
  assert.equal(classifyRwaSource({ configured: true, hasYield: false }), "binance-missing-yield");
  assert.equal(classifyRwaSource({ configured: true, emptyContract: true }), "unavailable");
});

test("classifyBnbSource never treats 451 as success", () => {
  assert.equal(classifyBnbSource({ restricted: true, hasApr: false }), "restricted");
  assert.equal(classifyBnbSource({ configured: false, hasApr: false }), "config-missing");
  assert.equal(
    classifyBnbSource({ configured: true, hasApr: true, usedSapi: true }),
    "binance-sapi-simple-earn"
  );
  assert.equal(
    classifyBnbSource({ configured: true, hasApr: false }),
    "binance-missing-apr"
  );
});

test("isRestrictedStatus detects HTTP 451 and eligibility wording", () => {
  assert.equal(isRestrictedStatus(451), true);
  assert.equal(
    isRestrictedStatus(200, "Service unavailable from a restricted location according to b. Eligibility"),
    true
  );
  assert.equal(isRestrictedStatus(500, "internal error"), false);
  assert.equal(isRestrictedStatus(401, "Invalid API-key"), false);
});

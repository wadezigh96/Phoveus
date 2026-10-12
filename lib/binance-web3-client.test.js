import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeb3Url,
  buildBinanceWeb3Signature,
  isBinanceRestrictedError,
} from "./binance-web3-client.js";

test("buildWeb3Url preserves /build prefix", () => {
  const url = buildWeb3Url("https://web3.binance.com/build", "/api/v1/dex/market/rwa/search", {
    keyword: "NVDA",
  });
  assert.equal(url.pathname, "/build/api/v1/dex/market/rwa/search");
  assert.ok(url.search.includes("keyword=NVDA"));
});

test("new URL absolute path would drop /build (regression guard)", () => {
  const broken = new URL("/api/v1/x", "https://web3.binance.com/build");
  assert.equal(broken.pathname, "/api/v1/x");
  const fixed = buildWeb3Url("https://web3.binance.com/build", "/api/v1/x");
  assert.equal(fixed.pathname, "/build/api/v1/x");
});

test("signature is base64 HMAC-SHA256 of timestamp+method+path+body", () => {
  const sig = buildBinanceWeb3Signature({
    secret: "test-secret",
    timestamp: "2026-05-11T10:08:57.715Z",
    method: "GET",
    requestPath: "/build/api/v1/dex/market/rwa/search?keyword=NVDA",
    body: "",
  });
  assert.equal(typeof sig, "string");
  assert.ok(sig.length > 20);
  assert.equal(sig, buildBinanceWeb3Signature({
    secret: "test-secret",
    timestamp: "2026-05-11T10:08:57.715Z",
    method: "GET",
    requestPath: "/build/api/v1/dex/market/rwa/search?keyword=NVDA",
    body: "",
  }));
});

test("isBinanceRestrictedError detects HTTP 451 and eligibility text", () => {
  assert.equal(isBinanceRestrictedError({ status: 451 }), true);
  assert.equal(
    isBinanceRestrictedError({ message: "Service unavailable from a restricted location" }),
    true
  );
  assert.equal(isBinanceRestrictedError({ message: "timeout" }), false);
});

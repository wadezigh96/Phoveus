import test from "node:test";
import assert from "node:assert/strict";
import { readVenusUsdtEarn, VENUS_USDT_EARN_CONFIG } from "./phoveus-venus-earn.js";

const EXPECTED_MARKET = "0xfd5840cd36d94d7229439859c0112a4185bc0255";

test("Venus USDT Earn returns exact BSC market data and remains read-only", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let requestedUrl;
  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.accept, "application/json");
    return {
      ok: true,
      json: async () => ({
        result: [{
          address: EXPECTED_MARKET,
          chainId: "56",
          symbol: "vUSDT",
          name: "Venus USDT",
          isListed: true,
          supplyApy: "3.46",
          supplyApyDecimal: "0.0346",
          borrowApy: "5.12",
          borrowApyDecimal: "0.0512",
          liquidityCents: "123456",
          pausedActionsBitmap: 0,
          supplierCount: 123,
        }],
      }),
    };
  };

  const result = await readVenusUsdtEarn();

  assert.equal(requestedUrl.origin, "https://api.venus.io");
  assert.equal(requestedUrl.pathname, "/markets");
  assert.equal(requestedUrl.searchParams.get("chainId"), "56");
  assert.equal(requestedUrl.searchParams.get("address"), EXPECTED_MARKET);
  assert.equal(result.ok, true);
  assert.equal(result.market.marketAddress, EXPECTED_MARKET);
  assert.equal(result.market.supplyApy, 3.46);
  assert.equal(result.market.supplyApyDecimal, 0.0346);
  assert.equal(result.market.isListed, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.executionLocked, true);
  assert.equal(result.orderForwarded, false);
  assert.equal(result.transactionPreviewAvailable, false);
  assert.equal(VENUS_USDT_EARN_CONFIG.chainId, "56");
});

test("Venus USDT Earn fails closed when the API returns the wrong market", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      result: [{
        address: "0x0000000000000000000000000000000000000001",
        chainId: "56",
        symbol: "vOTHER",
        isListed: true,
      }],
    }),
  });

  await assert.rejects(readVenusUsdtEarn(), /expected BSC market/);
});

test("Venus USDT Earn fails closed on an HTTP error", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ result: [] }),
  });

  await assert.rejects(readVenusUsdtEarn(), /unavailable or did not match/);
});

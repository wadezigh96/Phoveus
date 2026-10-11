import test from "node:test";
import assert from "node:assert/strict";
import { readBinanceRwaMarketData } from "./market-data.js";

test("rejects symbols outside the explicit allowlist", async () => {
  await assert.rejects(
    readBinanceRwaMarketData({ symbol: "UNKNOWN" }),
    /Unsupported RWA symbol/,
  );
});

test("returns Binance RWA price and labels stock dividend separately", async () => {
  let requestedUrl;

  const fakeFetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        code: "000000",
        data: {
          symbol: "NVDAB",
          tokenInfo: {
            price: "230.4792",
            sharesMultiplier: "1.000778223752807865",
            apy: null,
          },
          stockInfo: { dividendYield: "0.00120000" },
        },
      }),
    };
  };

  const result = await readBinanceRwaMarketData({ fetchImpl: fakeFetch });

  assert.match(requestedUrl, /chainId=56/);
  assert.match(
    requestedUrl,
    /contractAddress=0x02fca66c1d1afb4e2a7884261eb00f63598a7436/i,
  );
  assert.equal(result.tokenPriceUsd, 230.4792);
  assert.equal(result.underlyingStock.dividendYieldPct, 0.12);
  assert.equal(result.tokenApyPct, null);
  assert.equal(result.executionLocked, true);
  assert.equal(result.orderForwarded, false);
});

test("rejects a response with the wrong symbol", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      code: "000000",
      data: { symbol: "OTHER", tokenInfo: {}, stockInfo: {} },
    }),
  });

  await assert.rejects(
    readBinanceRwaMarketData({ fetchImpl: fakeFetch }),
    /unavailable or mismatched/,
  );
});

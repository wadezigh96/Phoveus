import test from "node:test";
import assert from "node:assert/strict";
import { getCmcQuote } from "./market-data.js";

test("requires a CMC API key", async () => {
  await assert.rejects(
    getCmcQuote({ apiKey: "" }),
    /CMC_API_KEY is not configured/,
  );
});

test("returns quote without claiming contract verification or yield", async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(options.headers["X-CMC_PRO_API_KEY"], "test-key");
    assert.equal(new URL(url).searchParams.get("symbol"), "NVDAB");
    return {
      ok: true,
      json: async () => ({
        status: { error_code: 0 },
        data: {
          NVDAB: [{
            id: 123,
            name: "Example Asset",
            quote: {
              USD: {
                price: 42,
                last_updated: "2026-10-11T00:00:00Z",
              },
            },
          }],
        },
      }),
    };
  };

  const result = await getCmcQuote({
    symbol: "NVDAB",
    apiKey: "test-key",
    fetchImpl: fakeFetch,
  });

  assert.equal(result.quotes[0].priceUsd, 42);
  assert.equal(result.contractVerified, false);
  assert.equal(result.dividendYieldPct, null);
  assert.equal(result.executionLocked, true);
});

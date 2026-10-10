import test from "node:test";
import assert from "node:assert/strict";
import { readPancakeSwapBscPools, PANCAKESWAP_BSC_CONFIG } from "./phoveus-pancakeswap.js";

test("PancakeSwap returns BSC indexed pools and remains read-only", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requestedUrl;
  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.accept, "application/json");
    return {
      ok: true,
      json: async () => ({
        hasNextPage: true,
        rows: [
          { chainId: 56, token0: { symbol: "CAKE" }, token1: { symbol: "USDT" }, protocol: "v3", tvlUSD: "1200000", volumeUSD24h: "300000", apr24h: "12.5", id: "0xpool1" },
          { chainId: 1, token0: { symbol: "WRONG" }, token1: { symbol: "CHAIN" }, tvlUSD: "9999999" },
        ],
      }),
    };
  };
  const result = await readPancakeSwapBscPools();
  assert.equal(requestedUrl.origin, "https://explorer.pancakeswap.com");
  assert.equal(requestedUrl.pathname, "/api/cached/pools/list");
  assert.equal(requestedUrl.searchParams.get("chains"), "bsc");
  assert.equal(requestedUrl.searchParams.get("limit"), "10");
  assert.equal(requestedUrl.searchParams.getAll("protocols").includes("v3"), true);
  assert.equal(result.chainId, "56");
  assert.equal(result.pools.length, 1);
  assert.equal(result.pools[0].name, "CAKE / USDT");
  assert.equal(result.pools[0].tvlUsd, 1200000);
  assert.equal(result.pools[0].apr24h, 12.5);
  assert.equal(result.readOnly, true);
  assert.equal(result.executionLocked, true);
  assert.equal(result.orderForwarded, false);
  assert.equal(result.transactionBuilt, false);
  assert.equal(PANCAKESWAP_BSC_CONFIG.chainId, "56");
});

test("PancakeSwap fails closed when no usable BSC pools are returned", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ rows: [{ chainId: 1, token0: { symbol: "wrong" }, token1: { symbol: "chain" } }] }),
  });
  await assert.rejects(readPancakeSwapBscPools(), /no usable BNB Chain pool rows/);
});

test("PancakeSwap fails closed on HTTP errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  await assert.rejects(readPancakeSwapBscPools(), /analytics are unavailable/);
});

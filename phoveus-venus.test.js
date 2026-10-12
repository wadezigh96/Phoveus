import { test } from "node:test";
import assert from "node:assert/strict";
import { readVenusBnbMarket, VBNB_MAINNET, BSC_MAINNET_CHAIN_ID } from "./phoveus-venus.js";

test("Venus BNB market targets exact mainnet vBNB address and chain 56", async () => {
  assert.equal(VBNB_MAINNET.toLowerCase(), "0xa07c5b74c9b40447a954e1466938b865b6bbea36");
  assert.equal(BSC_MAINNET_CHAIN_ID, "56");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      result: [
        {
          symbol: "vBNB",
          name: "Venus BNB",
          isListed: true,
          supplyApy: "0.02",
          borrowApy: "0.3",
        },
      ],
    }),
  });
  try {
    const market = await readVenusBnbMarket();
    assert.equal(market.chainId, "56");
    assert.equal(market.marketAddress, VBNB_MAINNET);
    assert.equal(market.executionLocked, true);
    assert.equal(market.readOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Venus BNB market fails closed when API returns empty result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ result: [] }),
  });
  try {
    await assert.rejects(() => readVenusBnbMarket(), /unavailable/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

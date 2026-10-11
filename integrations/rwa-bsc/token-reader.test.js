import test from "node:test";
import assert from "node:assert/strict";
import { readBscRwaToken } from "./token-reader.js";

const word = (value) => value.toString(16).padStart(64, "0");

const stringResult = (value) =>
  "0x" +
  word(32) +
  word(Buffer.byteLength(value, "utf8")) +
  Buffer.from(value, "utf8").toString("hex").padEnd(
    Math.ceil(Buffer.byteLength(value, "utf8") / 32) * 64 || 64,
    "0",
  );

test("rejects an RPC endpoint that is not BSC mainnet", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ result: "0x1" }),
  });

  await assert.rejects(
    readBscRwaToken({ fetchImpl: fakeFetch }),
    /not BNB Smart Chain mainnet/,
  );
});

test("reads token metadata and keeps price/yield unclaimed", async () => {
  const resultsBySelector = {
    "0x313ce567": "0x" + word(18),
    "0x95d89b41": stringResult("NVDAB"),
    "0x06fdde03": stringResult("NVIDIA Corp"),
    "0x18160ddd": "0x" + word(123456789),
  };

  const fakeFetch = async (_url, options) => {
    const req = JSON.parse(options.body);

    if (req.method === "eth_chainId") {
      return { ok: true, json: async () => ({ result: "0x38" }) };
    }

    const selector = req.params?.[0]?.data;
    return {
      ok: true,
      json: async () => ({ result: resultsBySelector[selector] }),
    };
  };

  const result = await readBscRwaToken({ fetchImpl: fakeFetch });

  assert.equal(result.chainId, 56);
  assert.equal(result.token.symbol, "NVDAB");
  assert.equal(result.token.name, "NVIDIA Corp");
  assert.equal(result.token.decimals, 18);
  assert.equal(result.token.totalSupplyRaw, "123456789");
  assert.equal(result.price, null);
  assert.equal(result.dividendYieldPct, null);
  assert.equal(result.executionLocked, true);
  assert.equal(result.orderForwarded, false);
});

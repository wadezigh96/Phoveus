import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalBawBridgeEnabled,
  validateLocalBawPreviewRequest,
} from "./phoveus-baw-local.js";

test("local BAW bridge requires explicit enablement, loopback, and a local host", (t) => {
  const originalEnabled = process.env.PHOVEUS_BAW_PREVIEW_ENABLED;
  const originalVercel = process.env.VERCEL;
  t.after(() => {
    if (originalEnabled === undefined) delete process.env.PHOVEUS_BAW_PREVIEW_ENABLED;
    else process.env.PHOVEUS_BAW_PREVIEW_ENABLED = originalEnabled;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  process.env.PHOVEUS_BAW_PREVIEW_ENABLED = "true";
  delete process.env.VERCEL;
  const localRequest = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost:8789" } };
  assert.equal(isLocalBawBridgeEnabled(localRequest), true);
  assert.equal(isLocalBawBridgeEnabled({ socket: { remoteAddress: "192.168.1.5" }, headers: { host: "localhost:8789" } }), false);
  assert.equal(isLocalBawBridgeEnabled({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "phoveus.example" } }), false);
  process.env.VERCEL = "1";
  assert.equal(isLocalBawBridgeEnabled(localRequest), false);
});

test("Venus deposit preview uses the fixed USDT product and preview-only CLI command", () => {
  const request = validateLocalBawPreviewRequest({ venue: "venus-usdt", action: "deposit", amount: "1" });
  assert.equal(request.action, "deposit");
  assert.equal(request.args[0], "defi");
  assert.equal(request.args[1], "preview");
  assert.equal(request.args.includes("--defiProtocolId"), true);
  assert.equal(request.args.includes("deposit"), true);
  assert.equal(request.args.includes("0x55d398326f99059ff775485246999027b3197955"), true);
  assert.equal(request.args.includes("baw"), false);
});

test("PancakeSwap LP add preview uses the fixed Infinity product and requires a range", () => {
  const request = validateLocalBawPreviewRequest({
    venue: "pancakeswap-infinity-cake-usdt",
    action: "lp-add",
    amount: "0.1",
    priceRange: "10",
    slippageBps: "auto",
  });
  assert.equal(request.args[1], "preview");
  assert.equal(request.args.includes("pancakeswap4"), true);
  assert.equal(request.args.includes("--priceRange"), true);
  assert.equal(request.args.includes("--slippageBps"), true);
});

test("LP removal requires a valid NFT ID and ratio", () => {
  assert.throws(() => validateLocalBawPreviewRequest({
    venue: "pancakeswap-infinity-cake-usdt",
    action: "lp-remove",
    ratio: "1",
  }), /NFT ID/);

  const request = validateLocalBawPreviewRequest({
    venue: "pancakeswap-infinity-cake-usdt",
    action: "lp-remove",
    nftId: "123",
    ratio: "1",
    slippageBps: "100",
  });
  assert.equal(request.args.includes("--nftId"), true);
  assert.equal(request.args.includes("--ratio"), true);
});

test("local preview rejects unknown venues and invalid amounts", () => {
  assert.throws(() => validateLocalBawPreviewRequest({ venue: "arbitrary", action: "deposit", amount: "1" }), /supported Venus or PancakeSwap/);
  assert.throws(() => validateLocalBawPreviewRequest({ venue: "venus-usdt", action: "deposit", amount: "0; baw wallet send" }), /valid positive amount/);
});

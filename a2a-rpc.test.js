import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isJsonRpcNotification,
  validateJsonRpcRequest,
  validateA2aUserMessage,
  parseYieldQueryFromText,
  mapYieldReportToTaskState,
} from "./a2a-rpc.js";

test("notifications are detected when id is omitted", () => {
  assert.equal(isJsonRpcNotification({ jsonrpc: "2.0", method: "message/send" }), true);
  assert.equal(
    isJsonRpcNotification({ jsonrpc: "2.0", id: 1, method: "message/send" }),
    false
  );
});

test("validateJsonRpcRequest rejects missing method or bad shape", () => {
  assert.equal(validateJsonRpcRequest(null).code, -32600);
  assert.equal(validateJsonRpcRequest({ jsonrpc: "2.0", method: "x" }).code, -32600);
  assert.equal(
    validateJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "message/send" }).ok,
    true
  );
});

test("validateA2aUserMessage requires user role and text parts", () => {
  assert.equal(validateA2aUserMessage({}).code, -32602);
  assert.equal(
    validateA2aUserMessage({
      message: { role: "user", parts: [{ kind: "data", data: {} }] },
    }).code,
    -32602
  );
  assert.equal(
    validateA2aUserMessage({
      message: { role: "user", parts: [{ text: "symbol: NVDA" }] },
    }).ok,
    true
  );
});

test("parseYieldQueryFromText extracts symbol and platform", () => {
  assert.deepEqual(parseYieldQueryFromText("symbol: TSLA platformId: ondo"), {
    symbol: "TSLA",
    platformId: "ondo",
  });
  assert.deepEqual(parseYieldQueryFromText(""), {
    symbol: "NVDA",
    platformId: "bstock",
  });
});

test("mapYieldReportToTaskState never completes incomplete analysis", () => {
  assert.equal(
    mapYieldReportToTaskState({
      analysisStatus: "incomplete",
      missingInputs: ["bnbFlexibleApr"],
      result: { relation: "INCOMPLETE" },
    }).state,
    "failed"
  );
  assert.equal(
    mapYieldReportToTaskState({
      analysisStatus: "complete",
      missingInputs: [],
      result: { relation: "RWA_ABOVE_BNB" },
    }).state,
    "completed"
  );
});

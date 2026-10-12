import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isJsonRpcNotification,
  validateJsonRpcRequest,
  validateA2aUserMessage,
  parseYieldQueryFromText,
  validateYieldQueryParams,
  mapYieldReportToTaskState,
  buildA2AYieldTask,
} from "./a2a-rpc.js";

test("notifications omit id", () => {
  assert.equal(isJsonRpcNotification({ jsonrpc: "2.0", method: "message/send" }), true);
});

test("invalid JSON-RPC rejected", () => {
  assert.equal(validateJsonRpcRequest({ jsonrpc: "2.0", method: "x" }).code, -32600);
});

test("message requires text parts", () => {
  assert.equal(validateA2aUserMessage({ message: { role: "user", parts: [] } }).code, -32602);
});

test("invalid platform fails validation", () => {
  const p = parseYieldQueryFromText("symbol: NVDA platformId: ethereum");
  assert.equal(validateYieldQueryParams(p).ok, false);
});

test("INCOMPLETE never maps to completed", () => {
  const m = mapYieldReportToTaskState({
    analysisStatus: "incomplete",
    result: { relation: "INCOMPLETE" },
    missingInputs: ["bnbFlexibleApr"],
  });
  assert.equal(m.state, "input-required");
  assert.notEqual(m.state, "completed");
});

test("complete comparison is completed", () => {
  assert.equal(
    mapYieldReportToTaskState({
      analysisStatus: "complete",
      result: { relation: "RWA_ABOVE_BNB" },
      missingInputs: [],
    }).state,
    "completed"
  );
});

test("provider error is failed", () => {
  assert.equal(mapYieldReportToTaskState({ providerError: true }).state, "failed");
});

test("buildA2AYieldTask locks execution", () => {
  const t = buildA2AYieldTask(1, {
    analysisStatus: "incomplete",
    result: { relation: "INCOMPLETE" },
    missingInputs: ["bnbFlexibleApr"],
  });
  assert.equal(t.status.state, "input-required");
  assert.equal(t.artifacts[0].parts[0].data.executionLocked, true);
  assert.equal(t.artifacts[0].parts[0].data.orderForwarded, false);
});

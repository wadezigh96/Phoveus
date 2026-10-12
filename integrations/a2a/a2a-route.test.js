import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateJsonRpcRequest,
  validateA2aUserMessage,
  parseYieldQueryFromText,
  validateYieldQueryParams,
  buildA2AYieldTask,
} from "../../a2a-rpc.js";

function simulateA2a(rpc, yieldBodyOrThrow) {
  if (rpc?.jsonrpc === "2.0" && typeof rpc.method === "string" && !Object.hasOwn(rpc, "id")) {
    return { httpStatus: 204, body: null };
  }
  const validated = validateJsonRpcRequest(rpc);
  const id = validated.ok ? validated.id : rpc?.id ?? null;
  if (!validated.ok) {
    return { httpStatus: 200, body: { jsonrpc: "2.0", id, error: { code: validated.code, message: validated.message } } };
  }
  if (validated.method !== "message/send") {
    return { httpStatus: 200, body: { jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported A2A method." } } };
  }
  const msgCheck = validateA2aUserMessage(rpc.params);
  if (!msgCheck.ok) {
    return { httpStatus: 200, body: { jsonrpc: "2.0", id, error: { code: msgCheck.code, message: msgCheck.message } } };
  }
  const input = msgCheck.message.parts.filter((p) => p?.text).map((p) => p.text).join(" ");
  const parsed = parseYieldQueryFromText(input);
  const q = validateYieldQueryParams(parsed);
  if (!q.ok) {
    return { httpStatus: 200, body: { jsonrpc: "2.0", id, error: { code: q.code, message: q.message } } };
  }
  try {
    const body = typeof yieldBodyOrThrow === "function" ? yieldBodyOrThrow(q) : yieldBodyOrThrow;
    return { httpStatus: 200, body: { jsonrpc: "2.0", id, result: buildA2AYieldTask(id, body) } };
  } catch {
    return {
      httpStatus: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: buildA2AYieldTask(id, { providerError: true, taskFailed: true }),
      },
    };
  }
}

test("route path: complete → completed locked", () => {
  const out = simulateA2a(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: { message: { role: "user", parts: [{ text: "symbol: NVDA platformId: bstock" }] } },
    },
    {
      analysisStatus: "complete",
      missingInputs: [],
      result: { relation: "RWA_ABOVE_BNB", rwaYieldPct: 2, bnbYieldPct: 1 },
    }
  );
  assert.equal(out.body.result.status.state, "completed");
  assert.equal(out.body.result.artifacts[0].parts[0].data.executionLocked, true);
  assert.equal(out.body.result.artifacts[0].parts[0].data.orderForwarded, false);
});

test("route path: INCOMPLETE → not completed", () => {
  const out = simulateA2a(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "message/send",
      params: { message: { role: "user", parts: [{ text: "symbol: NVDA platformId: bstock" }] } },
    },
    {
      analysisStatus: "incomplete",
      missingInputs: ["bnbFlexibleApr"],
      result: { relation: "INCOMPLETE", rwaYieldPct: 0.12, bnbYieldPct: null },
    }
  );
  assert.notEqual(out.body.result.status.state, "completed");
  assert.equal(out.body.result.status.state, "input-required");
});

test("route path: invalid platform does not call provider", () => {
  let called = false;
  const out = simulateA2a(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "message/send",
      params: { message: { role: "user", parts: [{ text: "symbol: NVDA platformId: ethereum" }] } },
    },
    () => {
      called = true;
      return {};
    }
  );
  assert.equal(called, false);
  assert.equal(out.body.error.code, -32602);
});

test("route path: provider throw → failed", () => {
  const out = simulateA2a(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "message/send",
      params: { message: { role: "user", parts: [{ text: "symbol: NVDA platformId: bstock" }] } },
    },
    () => {
      throw new Error("net");
    }
  );
  assert.equal(out.body.result.status.state, "failed");
});

test("route path: unsupported method", () => {
  const out = simulateA2a({ jsonrpc: "2.0", id: 5, method: "tasks/cancel", params: {} }, {});
  assert.equal(out.body.error.code, -32601);
});

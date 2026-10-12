/**
 * Offline contract tests plus real in-process Express HTTP route tests.
 * All yield data is injected; no external service calls are made.
 */
import { test } from "node:test";
import express from "express";
import { registerA2aRoute, setA2aYieldProvider, resetA2aYieldProvider } from "./express-route.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isJsonRpcNotification,
  validateJsonRpcRequest,
  validateA2aUserMessage,
  parseYieldQueryFromText,
  validateYieldQueryParams,
  buildA2AYieldTask,
} from "../../a2a-rpc.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("server.js A2A route is wired via registerA2aRoute (source contract)", () => {
  const src = readFileSync(join(root, "server.js"), "utf8");
  const routeSrc = readFileSync(join(root, "integrations/a2a/express-route.js"), "utf8");
  assert.match(src, /registerA2aRoute\s*\(/);
  assert.doesNotMatch(src, /app\.post\(\s*"\/api\/a2a"/);
  assert.match(routeSrc, /buildA2AYieldTask/);
  assert.doesNotMatch(routeSrc, /status:\s*\{\s*state:\s*"completed"\s*\}/);
  assert.match(routeSrc, /validateYieldQueryParams/);
});

async function handleA2a(rpc, provider) {
  if (isJsonRpcNotification(rpc)) return { status: 204, body: null };
  const validated = validateJsonRpcRequest(rpc);
  const id = validated.ok ? validated.id : rpc?.id ?? null;
  const fail = (code, message) => ({
    status: 200,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  });
  if (!validated.ok) return fail(validated.code, validated.message);
  if (validated.method !== "message/send") return fail(-32601, "Unsupported A2A method.");
  const msgCheck = validateA2aUserMessage(rpc.params);
  if (!msgCheck.ok) return fail(msgCheck.code, msgCheck.message);
  const input = msgCheck.message.parts
    .filter((p) => p && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .slice(0, 2000);
  if (input.length >= 2000) return fail(-32602, "Message text exceeds maximum length of 2000 characters.");
  const parsed = parseYieldQueryFromText(input);
  const q = validateYieldQueryParams(parsed);
  if (!q.ok) return fail(q.code, q.message);
  try {
    const body = await provider(q);
    if (body?.ok === false) return fail(-32602, body.error || "Invalid yield-analysis parameters.");
    return { status: 200, body: { jsonrpc: "2.0", id, result: buildA2AYieldTask(id, body) } };
  } catch {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: buildA2AYieldTask(id, {
          providerError: true,
          taskFailed: true,
          errorMessage: "Yield analysis failed. No transaction was sent.",
        }),
      },
    };
  }
}

const msg = (text) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "message/send",
  params: { message: { role: "user", parts: [{ text }] } },
});

test("HTTP-contract: complete comparison → completed + safety", async () => {
  let calls = 0;
  const out = await handleA2a(msg("symbol: NVDA platformId: bstock"), async () => {
    calls += 1;
    return {
      analysisStatus: "complete",
      missingInputs: [],
      result: { relation: "RWA_ABOVE_BNB", rwaYieldPct: 2, bnbYieldPct: 1 },
    };
  });
  assert.equal(calls, 1);
  assert.equal(out.body.result.status.state, "completed");
  assert.equal(out.body.result.artifacts[0].parts[0].data.executionLocked, true);
  assert.equal(out.body.result.artifacts[0].parts[0].data.orderForwarded, false);
});

test("HTTP-contract: missing BNB APR → never completed", async () => {
  const out = await handleA2a(msg("symbol: NVDA platformId: bstock"), async () => ({
    analysisStatus: "incomplete",
    missingInputs: ["bnbFlexibleApr"],
    result: { relation: "INCOMPLETE", rwaYieldPct: 0.12, bnbYieldPct: null },
  }));
  assert.notEqual(out.body.result.status.state, "completed");
  assert.equal(out.body.result.status.state, "input-required");
});

test("HTTP-contract: missing RWA → never completed", async () => {
  const out = await handleA2a(msg("symbol: MSFT platformId: bstock"), async () => ({
    analysisStatus: "incomplete",
    missingInputs: ["rwaDividendYield"],
    result: { relation: "INCOMPLETE", rwaYieldPct: null, bnbYieldPct: 5 },
  }));
  assert.notEqual(out.body.result.status.state, "completed");
});

test("HTTP-contract: provider throw → failed", async () => {
  const out = await handleA2a(msg("symbol: NVDA platformId: bstock"), async () => {
    throw new Error("upstream");
  });
  assert.equal(out.body.result.status.state, "failed");
  assert.equal(out.body.result.artifacts[0].parts[0].data.executionLocked, true);
});

test("HTTP-contract: invalid platform never invokes provider", async () => {
  let calls = 0;
  const out = await handleA2a(msg("symbol: NVDA platformId: ethereum"), async () => {
    calls += 1;
    return {};
  });
  assert.equal(calls, 0);
  assert.equal(out.body.error.code, -32602);
});

test("HTTP-contract: unsupported method → -32601", async () => {
  const out = await handleA2a(
    { jsonrpc: "2.0", id: 9, method: "tasks/cancel", params: {} },
    async () => ({})
  );
  assert.equal(out.body.error.code, -32601);
});

test("HTTP-contract: notification → 204", async () => {
  const out = await handleA2a(
    { jsonrpc: "2.0", method: "message/send", params: {} },
    async () => ({})
  );
  assert.equal(out.status, 204);
});

test("HTTP-contract: empty parts rejected", async () => {
  const out = await handleA2a(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "message/send",
      params: { message: { role: "user", parts: [{ kind: "data", data: {} }] } },
    },
    async () => ({})
  );
  assert.equal(out.body.error.code, -32602);
});


test("real Express A2A route over loopback HTTP uses injected provider and preserves task states", async () => {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  registerA2aRoute(app, {
    simpleRateLimit: () => (_req, _res, next) => next(),
    termixYieldHandler: async () => {
      throw new Error("Injected provider should be used; external provider must not run in this test.");
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/a2a`;
  const request = async (payload) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const rpc = (id, text) => ({
    jsonrpc: "2.0",
    id,
    method: "message/send",
    params: { message: { role: "user", parts: [{ text }] } },
  });

  try {
    let providerCalls = 0;
    setA2aYieldProvider(async ({ symbol, platformId }) => {
      providerCalls += 1;
      assert.equal(symbol, "NVDA");
      assert.equal(platformId, "bstock");
      return {
        analysisStatus: "complete",
        missingInputs: [],
        result: { relation: "RWA_ABOVE_BNB", rwaYieldPct: 2, bnbYieldPct: 1 },
      };
    });
    let response = await request(rpc(11, "Analyze symbol: nvda platformId: bstock"));
    assert.equal(response.status, 200);
    let json = await response.json();
    assert.equal(json.result.status.state, "completed");
    assert.equal(json.result.artifacts[0].parts[0].data.executionLocked, true);
    assert.equal(json.result.artifacts[0].parts[0].data.orderForwarded, false);
    assert.equal(providerCalls, 1);

    setA2aYieldProvider(async () => ({
      analysisStatus: "incomplete",
      missingInputs: ["bnbFlexibleApr"],
      result: { relation: "INCOMPLETE", rwaYieldPct: 0.12, bnbYieldPct: null },
    }));
    response = await request(rpc(12, "Analyze symbol: NVDA platformId: bstock"));
    json = await response.json();
    assert.equal(json.result.status.state, "input-required");
    assert.notEqual(json.result.status.state, "completed");
    assert.equal(json.result.artifacts[0].parts[0].data.executionLocked, true);
    assert.equal(json.result.artifacts[0].parts[0].data.orderForwarded, false);

    setA2aYieldProvider(async () => { throw new Error("provider unavailable"); });
    response = await request(rpc(13, "Analyze symbol: NVDA platformId: bstock"));
    json = await response.json();
    assert.equal(json.result.status.state, "failed");
    assert.equal(json.result.artifacts[0].parts[0].data.executionLocked, true);
    assert.equal(json.result.artifacts[0].parts[0].data.orderForwarded, false);

    providerCalls = 0;
    setA2aYieldProvider(async () => {
      providerCalls += 1;
      return {};
    });
    response = await request(rpc(14, "Analyze symbol: NVDA platformId: ethereum"));
    json = await response.json();
    assert.equal(json.error.code, -32602);
    assert.equal(providerCalls, 0);

    response = await request({ jsonrpc: "2.0", id: 15, method: "tasks/cancel", params: {} });
    json = await response.json();
    assert.equal(json.error.code, -32601);

    response = await request({
      jsonrpc: "2.0",
      id: 16,
      method: "message/send",
      params: { message: { role: "user", parts: [{ text: "Analyze symbol: NVDA" }] } },
    });
    json = await response.json();
    assert.equal(json.error.code, -32602);
    assert.equal(providerCalls, 0);
  } finally {
    resetA2aYieldProvider();
    await new Promise((resolve) => server.close(resolve));
  }
});

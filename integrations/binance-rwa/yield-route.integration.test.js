import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("RWA yield route reports missing Web3 config and HTTP 451 truthfully, fail-closed", async (t) => {
  process.env.VERCEL = "1";
  delete process.env.BINANCE_WEB3_API_KEY;
  delete process.env.BINANCE_WEB3_API_SECRET;
  process.env.BINANCE_SAPI_API_KEY = "test-key";
  process.env.BINANCE_SAPI_API_SECRET = "test-secret";

  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    upstreamCalls.push(url);
    return new Response(JSON.stringify({
      code: -1,
      msg: "Service unavailable from a restricted location according to b. Eligibility"
    }), {
      status: 451,
      headers: { "content-type": "application/json" }
    });
  };

  let server;
  try {
    const { default: app } = await import("../../server.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    t.after(async () => {
      await new Promise((resolve) => server?.close(resolve));
      globalThis.fetch = originalFetch;
    });

    const address = server.address();
    const result = await new Promise((resolve, reject) => {
      const req = http.get({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/rwa/yield?symbol=NVDA&platformId=bstock",
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on("error", reject);
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.rwa.source, "config-missing");
    assert.match(result.body.rwa.error, /credentials are not configured/i);
    assert.equal(result.body.rwa.dividendYieldPct, null);
    assert.equal(result.body.bnb.source, "restricted");
    assert.equal(result.body.bnb.aprPct, null);
    assert.equal(result.body.comparison.relation, "INCOMPLETE");
    assert.equal(result.body.comparison.spreadPct, null);
    assert.equal(result.body.executionLocked, true);
    assert.equal(result.body.orderForwarded, false);
    assert.equal(upstreamCalls.length, 1);
    assert.match(upstreamCalls[0], /api\.binance\.com\/sapi\/v1\/simple-earn\/flexible\/list/);
    assert.equal(upstreamCalls.some((url) => /web3\.binance\.com/.test(url)), false);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});

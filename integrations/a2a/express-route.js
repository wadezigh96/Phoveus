/**
 * Express A2A route registration for Phoveus.
 * Uses a2a-rpc helpers. Injectable provider for offline tests only.
 */
import {
  isJsonRpcNotification,
  validateJsonRpcRequest,
  validateA2aUserMessage,
  parseYieldQueryFromText,
  validateYieldQueryParams,
  buildA2AYieldTask,
} from "../../a2a-rpc.js";

let a2aYieldProvider = null;

export function setA2aYieldProvider(fn) {
  a2aYieldProvider = typeof fn === "function" ? fn : null;
}

export function resetA2aYieldProvider() {
  a2aYieldProvider = null;
}

/**
 * @param {import("express").Express} app
 * @param {{ simpleRateLimit: Function, termixYieldHandler: Function }} deps
 */
export function registerA2aRoute(app, { simpleRateLimit, termixYieldHandler }) {
  app.post("/api/a2a", simpleRateLimit(20), async (req, res) => {
    const rpc = req.body;

    if (isJsonRpcNotification(rpc)) {
      return res.status(204).end();
    }

    const validated = validateJsonRpcRequest(rpc);
    const id = validated.ok ? validated.id : (rpc && Object.hasOwn(rpc, "id") ? rpc.id : null);
    const send = (payload) => res.status(200).json({ jsonrpc: "2.0", id, ...payload });
    const fail = (code, message) => send({ error: { code, message } });

    if (!validated.ok) {
      return fail(validated.code, validated.message);
    }

    if (validated.method !== "message/send") {
      return fail(-32601, "Unsupported A2A method.");
    }

    const msgCheck = validateA2aUserMessage(rpc.params);
    if (!msgCheck.ok) {
      return fail(msgCheck.code, msgCheck.message);
    }

    const input = msgCheck.message.parts
      .filter((p) => p && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ")
      .slice(0, 2000);

    if (input.length >= 2000) {
      return fail(-32602, "Message text exceeds maximum length of 2000 characters.");
    }

    const parsed = parseYieldQueryFromText(input, { requireExplicit: true });
    const queryCheck = validateYieldQueryParams({
      symbol: parsed.symbol,
      platformId: parsed.platformId,
    });
    if (!queryCheck.ok) {
      return fail(queryCheck.code, queryCheck.message);
    }
    const { symbol, platformId } = queryCheck;

    try {
      let body;
      if (a2aYieldProvider) {
        body = await a2aYieldProvider({ symbol, platformId, text: input });
      } else {
        let captured;
        const fakeReq = { query: { symbol, platformId }, ip: req.ip };
        const fakeRes = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(value) {
            captured = { statusCode: this.statusCode, body: value };
            return value;
          },
        };
        await termixYieldHandler(fakeReq, fakeRes);
        if (!captured) {
          const task = buildA2AYieldTask(id, {
            providerError: true,
            taskFailed: true,
            errorMessage: "Yield analysis failed. No transaction was sent.",
          });
          return send({ result: task });
        }
        if (captured.statusCode >= 500) {
          const task = buildA2AYieldTask(id, {
            providerError: true,
            taskFailed: true,
            errorMessage: "Yield provider is unavailable. No transaction was sent.",
          });
          return send({ result: task });
        }
        if (captured.statusCode >= 400) {
          return fail(-32602, captured.body?.error || "Invalid yield-analysis parameters.");
        }
        body = captured.body || {};
      }

      if (body && body.ok === false) {
        return fail(-32602, body.error || "Invalid yield-analysis parameters.");
      }

      const task = buildA2AYieldTask(id, body);
      return send({ result: task });
    } catch {
      const task = buildA2AYieldTask(id, {
        providerError: true,
        taskFailed: true,
        errorMessage: "Yield analysis failed. No transaction was sent.",
      });
      return send({ result: task });
    }
  });
}

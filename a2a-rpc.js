/**
 * Pure A2A / JSON-RPC helpers for Phoveus.
 * No network, no secrets, no transaction paths.
 */

export function isJsonRpcNotification(rpc) {
  return (
    rpc &&
    typeof rpc === "object" &&
    !Array.isArray(rpc) &&
    rpc.jsonrpc === "2.0" &&
    typeof rpc.method === "string" &&
    !Object.hasOwn(rpc, "id")
  );
}

export function validateJsonRpcRequest(rpc) {
  if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== "2.0") {
    return { ok: false, code: -32600, message: "Invalid JSON-RPC request." };
  }
  if (!Object.hasOwn(rpc, "id")) {
    return { ok: false, code: -32600, message: "Invalid JSON-RPC request." };
  }
  const id = rpc.id;
  const idOk =
    typeof id === "string" ||
    (typeof id === "number" && Number.isSafeInteger(id)) ||
    id === null;
  if (!idOk || typeof rpc.method !== "string") {
    return { ok: false, code: -32600, message: "Invalid JSON-RPC request." };
  }
  return { ok: true, id, method: rpc.method };
}

export function validateA2aUserMessage(params) {
  const message = params?.message;
  if (!message || message.role !== "user" || !Array.isArray(message.parts)) {
    return {
      ok: false,
      code: -32602,
      message: "Expected params.message with role user and parts.",
    };
  }
  const hasText = message.parts.some(
    (p) => p && typeof p.text === "string" && p.text.trim().length > 0
  );
  if (!hasText) {
    return {
      ok: false,
      code: -32602,
      message: "Expected at least one non-empty text part in message.parts.",
    };
  }
  return { ok: true, message };
}

export function parseYieldQueryFromText(input, { requireExplicit = false } = {}) {
  const text = String(input || "").slice(0, 2000);
  const symbolMatch = text.match(/\b(?:symbol|ticker)\s*[:=]\s*([A-Z0-9._-]{1,20})/i);
  const platformAny = text.match(/\bplatform(?:Id)?\s*[:=]\s*([A-Za-z0-9_-]+)/i);
  const platformMatch = text.match(/\bplatform(?:Id)?\s*[:=]\s*(ondo|bstock)\b/i);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : requireExplicit ? null : "NVDA";
  let platformId;
  if (platformMatch) {
    platformId = platformMatch[1].toLowerCase();
  } else if (platformAny) {
    platformId = platformAny[1].toLowerCase();
  } else {
    platformId = requireExplicit ? null : "bstock";
  }
  return { symbol, platformId, text };
}

export function validateYieldQueryParams({ symbol, platformId }) {
  if (!symbol || !/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
    return {
      ok: false,
      code: -32602,
      message: "symbol/ticker must be 1-20 alphanumeric characters (e.g. symbol: NVDA).",
    };
  }
  if (!platformId || !["ondo", "bstock"].includes(platformId)) {
    return {
      ok: false,
      code: -32602,
      message: "platformId must be ondo or bstock (e.g. platformId: bstock).",
    };
  }
  return { ok: true, symbol, platformId };
}

/**
 * Map yield analysis body to A2A task state.
 * INCOMPLETE must never be "completed".
 */
export function mapYieldReportToTaskState(body) {
  if (body?.providerError || body?.taskFailed === true) {
    return {
      state: "failed",
      message:
        body?.errorMessage ||
        "Yield analysis failed due to a provider error. No transaction was sent.",
    };
  }
  const incomplete =
    body?.analysisStatus === "incomplete" ||
    body?.result?.relation === "INCOMPLETE" ||
    (Array.isArray(body?.missingInputs) && body.missingInputs.length > 0);
  if (incomplete) {
    return {
      state: "input-required",
      message:
        "Partial yield report: required upstream RWA or BNB data was unavailable. Comparison is INCOMPLETE. No transaction was sent.",
    };
  }
  const relation = body?.result?.relation;
  if (
    relation === "RWA_ABOVE_BNB" ||
    relation === "RWA_BELOW_BNB" ||
    relation === "MATCH"
  ) {
    return {
      state: "completed",
      message: "Read-only yield comparison completed. Execution remains locked.",
    };
  }
  return {
    state: "input-required",
    message:
      "Partial yield report: comparison could not be finalized. No transaction was sent.",
  };
}

export function buildA2AYieldTask(id, body) {
  const mapped = mapYieldReportToTaskState(body || {});
  const safeBody = {
    ...(body && typeof body === "object" ? body : {}),
    executionLocked: true,
    orderForwarded: false,
  };
  return {
    kind: "task",
    id: "phoveus-yield-" + String(id),
    contextId: "phoveus-context-" + String(id),
    status: {
      state: mapped.state,
      message: {
        role: "agent",
        parts: [{ kind: "text", text: mapped.message }],
      },
    },
    artifacts: [
      {
        artifactId: "yield-report",
        name: "Read-only yield report",
        parts: [{ kind: "data", data: safeBody }],
      },
    ],
  };
}

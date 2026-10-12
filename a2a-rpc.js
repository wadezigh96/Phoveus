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

export function parseYieldQueryFromText(input) {
  const text = String(input || "").slice(0, 2000);
  const symbol = (
    text.match(/\b(?:symbol|ticker)\s*[:=]\s*([A-Z0-9._-]{1,20})/i)?.[1] || "NVDA"
  ).toUpperCase();
  const platformId = (
    text.match(/\bplatform(?:Id)?\s*[:=]\s*(ondo|bstock)\b/i)?.[1] || "bstock"
  ).toLowerCase();
  return { symbol, platformId };
}

/**
 * Map yield analysis body to A2A task state.
 * Incomplete upstream data must never be reported as completed.
 */
export function mapYieldReportToTaskState(body) {
  const incomplete =
    body?.analysisStatus === "incomplete" ||
    body?.result?.relation === "INCOMPLETE" ||
    (Array.isArray(body?.missingInputs) && body.missingInputs.length > 0);
  if (incomplete) {
    return {
      state: "failed",
      message:
        "Yield analysis incomplete: required upstream data was unavailable. No transaction was sent.",
    };
  }
  return {
    state: "completed",
    message: "Read-only yield analysis completed. Execution remains locked.",
  };
}

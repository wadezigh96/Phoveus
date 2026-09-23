import crypto from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

export const BINANCE_AGENT_OS_URL = "https://agent.binance.com/mcp/agentic";
const COOKIE_NAME = "phoveus_agent_session";
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();

function cleanup() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

function randomId() {
  return crypto.randomBytes(24).toString("base64url");
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map((part) => {
      const i = part.indexOf("=");
      if (i < 0) return [part.trim(), ""];
      return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
    }).filter(([k]) => k)
  );
}

function setSessionCookie(res, id) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`
  );
}

function providerFor(session, redirectUrl) {
  const provider = {
    lastState: session.state,
    redirectUrl,
    clientMetadata: {
      client_name: "Phoveus Agent OS",
      redirect_uris: [redirectUrl],
      application_type: "web",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    state() {
      return this.lastState;
    },
    clientInformation() {
      return session.clientInformation;
    },
    saveClientInformation(info) {
      session.clientInformation = info;
    },
    tokens() {
      return session.tokens;
    },
    saveTokens(tokens) {
      session.tokens = tokens;
      session.expiresAt = Date.now() + SESSION_TTL_MS;
    },
    saveCodeVerifier(verifier) {
      session.codeVerifier = verifier;
    },
    codeVerifier() {
      if (!session.codeVerifier) throw new Error("No OAuth code verifier is available.");
      return session.codeVerifier;
    },
    redirectToAuthorization(url) {
      session.authorizationUrl = url.toString();
    },
    saveDiscoveryState(state) {
      session.discoveryState = state;
    },
    discoveryState() {
      return session.discoveryState;
    },
  };
  return provider;
}

export function getSessionId(req, res) {
  cleanup();
  const cookies = parseCookies(req);
  let id = cookies[COOKIE_NAME];
  if (!id || !sessions.has(id)) {
    id = randomId();
    sessions.set(id, {
      id,
      state: randomId(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      tokens: undefined,
      clientInformation: undefined,
      codeVerifier: undefined,
      discoveryState: undefined,
      authorizationUrl: undefined,
    });
    setSessionCookie(res, id);
  } else {
    sessions.get(id).expiresAt = Date.now() + SESSION_TTL_MS;
  }
  return id;
}

export function getAgentOsProvider(req, res) {
  const id = getSessionId(req, res);
  const session = sessions.get(id);
  return { id, session, provider: providerFor(session, getRedirectUrl(req)) };
}

function getRedirectUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/agent-os/callback`;
}

export async function beginAgentOsAuth(req, res) {
  const { id, session, provider } = getAgentOsProvider(req, res);
  session.state = randomId();
  provider.lastState = session.state;
  session.authorizationUrl = undefined;

  const result = await auth(provider, { serverUrl: BINANCE_AGENT_OS_URL });
  if (result === "AUTHORIZED") {
    return { id, authorized: true, authorizationUrl: null };
  }

  if (!session.authorizationUrl) {
    throw new Error("Binance Agent OS did not return an authorization URL.");
  }

  return { id, authorized: false, authorizationUrl: session.authorizationUrl };
}

export async function finishAgentOsAuth(req, res, code, state) {
  const { id, session, provider } = getAgentOsProvider(req, res);
  if (!code) throw new Error("Missing OAuth authorization code.");
  if (!state || state !== session.state) throw new Error("OAuth state validation failed.");

  const result = await auth(provider, {
    serverUrl: BINANCE_AGENT_OS_URL,
    authorizationCode: code,
  });

  if (result !== "AUTHORIZED" || !session.tokens?.access_token) {
    throw new Error("Binance Agent OS authorization did not complete.");
  }

  session.authorizationUrl = undefined;
  session.codeVerifier = undefined;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id, authorized: true };
}

export function isAgentOsAuthorized(req, res) {
  const { session } = getAgentOsProvider(req, res);
  return Boolean(session?.tokens?.access_token);
}

export function requireAgentOsProvider(req, res) {
  const { session, provider } = getAgentOsProvider(req, res);
  if (!session?.tokens?.access_token) {
    const err = new Error("Binance Agent OS is not authorized for this browser session.");
    err.status = 401;
    throw err;
  }
  return provider;
}

export function clearAgentOsSession(req, res) {
  const cookies = parseCookies(req);
  const id = cookies[COOKIE_NAME];
  if (id) sessions.delete(id);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

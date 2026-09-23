import crypto from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

export const BINANCE_AGENT_OS_URL = "https://agent.binance.com/mcp/agentic";
const COOKIE_NAME = "phoveus_agent_session";
const SESSION_TTL_SECONDS = 1800;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

function secretKey() {
  const raw = process.env.PHOVEUS_SESSION_SECRET || process.env.ADMIN_DEBUG_KEY || "";
  if (!raw) throw new Error("PHOVEUS_SESSION_SECRET or ADMIN_DEBUG_KEY must be configured.");
  return crypto.createHash("sha256").update(raw).digest();
}

function randomId() {
  return crypto.randomBytes(24).toString("base64url");
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function unseal(value) {
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function loadSession(req) {
  const cookies = parseCookies(req);
  const session = cookies[COOKIE_NAME] ? unseal(cookies[COOKIE_NAME]) : null;
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

function saveSession(res, session) {
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const value = seal(session);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http"))
    .split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (!host) throw new Error("Cannot determine public callback host.");
  return `${proto}://${host}`;
}

function redirectUrl(req) {
  return `${publicBaseUrl(req)}/api/agent-os/callback`;
}

function clientMetadataUrl(req) {
  return `${publicBaseUrl(req)}/api/agent-os/client-metadata`;
}

function providerFor(session, req, res) {
  const callback = redirectUrl(req);
  const metadataUrl = clientMetadataUrl(req);
  return {
    clientMetadataUrl: metadataUrl,
    get redirectUrl() {
      return callback;
    },
    get clientMetadata() {
      return {
        client_id: metadataUrl,
        client_name: "Phoveus Agent OS",
        client_uri: publicBaseUrl(req),
        redirect_uris: [callback],
        application_type: "web",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      };
    },
    state() {
      return session.state;
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
      saveSession(res, session);
    },
    saveCodeVerifier(verifier) {
      session.codeVerifier = verifier;
      saveSession(res, session);
    },
    codeVerifier() {
      if (!session.codeVerifier) throw new Error("No OAuth code verifier is available.");
      return session.codeVerifier;
    },
    redirectToAuthorization(url) {
      session.authorizationUrl = String(url);
      saveSession(res, session);
    },
    saveDiscoveryState(state) {
      session.discoveryState = state;
      saveSession(res, session);
    },
    discoveryState() {
      return session.discoveryState;
    },
  };
}

export function getAgentOsProvider(req, res) {
  const session = loadSession(req) || {
    id: randomId(),
    state: randomId(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    tokens: undefined,
    clientInformation: undefined,
    codeVerifier: undefined,
    discoveryState: undefined,
    authorizationUrl: undefined,
  };
  saveSession(res, session);
  return { session, provider: providerFor(session, req, res) };
}

export async function beginAgentOsAuth(req, res) {
  const { session, provider } = getAgentOsProvider(req, res);
  session.state = randomId();
  session.authorizationUrl = undefined;
  saveSession(res, session);

  const result = await auth(provider, { serverUrl: BINANCE_AGENT_OS_URL });
  if (result === "AUTHORIZED") {
    saveSession(res, session);
    return { authorized: true };
  }
  if (!session.authorizationUrl) {
    throw new Error("Binance Agent OS did not return an authorization URL.");
  }
  saveSession(res, session);
  return { authorized: false, authorizationUrl: session.authorizationUrl };
}

export async function finishAgentOsAuth(req, res, params) {
  const { session, provider } = getAgentOsProvider(req, res);
  const code = String(params?.code || "");
  const state = String(params?.state || "");
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
  saveSession(res, session);
  return { authorized: true };
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
  clearCookie(res);
}

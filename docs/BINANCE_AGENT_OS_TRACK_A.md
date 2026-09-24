# Phoveus — Binance Agent OS Track A

Updated: 2026-09-24

## Track A target

Binance's official Agent OS Mini Hackathon describes Track A as building an AI agent with Agent OS. The official entry instructions require a video/demo plus the GitHub repository, and the submission deadline was September 8, 2026 at 23:59 UTC.

Phoveus is structured as an Agent OS application rather than a generic trading UI:

```text
Tokenized-stock discovery
        ↓
RWA research
        ↓
Market Clock
        ↓
Risk Guard
        ↓
Agent reasoning
        ↓
Human approval
        ↓
Binance Agent OS / Agentic Wallet boundary
```

## What Phoveus demonstrates

- Tokenized-stock intelligence focused on bStocks.
- Binance Web3 RWA API integration on the server side.
- Market/reference-price comparison and reference-age handling.
- Market-open / closed / reopening state.
- Deterministic execution guard.
- Agent decision trace and evidence ledger.
- Human approval before state-changing execution.
- Binance Agent OS MCP authorization path using OAuth + PKCE.
- Fail-closed behavior when live RWA data or execution capability is unavailable.
- No fabricated live prices or transaction hashes.

## Agent OS integration points

### Authorization

Production routes:

- `GET /api/agent-os/connect`
- `GET /api/agent-os/callback`
- `GET /api/agent-os/client-metadata`
- `GET /api/agent-os/status`

The OAuth implementation stores the Agent OS session server-side in an encrypted HttpOnly cookie. No Agent OS access token is embedded in frontend source.

### Agent capabilities

- `GET /api/agent/capabilities` exposes the Phoveus skill registry and execution policy.
- `GET /api/agent/mcp-capabilities` is protected debug tooling for inspecting connected MCP capabilities.
- `GET /api/tools?key=...` is protected debug tooling for discovered MCP tools.

The order boundary does not guess an MCP tool schema.

### Execution policy

A state-changing action must pass all of these gates:

1. Valid market/RWA context.
2. Risk Guard permits the state.
3. Explicit human confirmation.
4. Connected/authorized Agent OS capability.
5. Verified MCP tool and input schema.
6. Only then may an execution adapter be enabled.

If a required capability is missing, Phoveus returns a guarded state instead of pretending that execution succeeded.

## Reproducible judge/demo path

1. Open the deployed Phoveus app.
2. Open the Agent OS authorization flow.
3. Authenticate through Binance's supported authorization flow.
4. Return to Phoveus and verify the session/capability state.
5. Search/select NVDA or another supported tokenized stock.
6. Show the RWA source label: LIVE only when the current response is actually live; otherwise DEMO FALLBACK.
7. Run Phoveus Analysis.
8. Show the Decision Trace and Evidence Ledger.
9. Show Market Clock + reference age + divergence + Risk Guard.
10. Show the explicit human approval boundary.
11. If the connected Agent OS runtime exposes a verified order capability, demonstrate the approval flow without bypassing Binance controls.
12. If the runtime is restricted/unavailable, demonstrate the fail-closed behavior and state that execution is locked.

## What is intentionally not claimed

- Phoveus does not claim that a restricted-location RWA response is live.
- Phoveus does not claim live trading merely because an MCP adapter exists.
- Phoveus does not invent an order-tool schema.
- Phoveus does not expose API keys, private keys, or Agent OS tokens in the browser.
- Phoveus does not bypass Binance geographic or authorization restrictions.

## Evidence to capture for a final demo

Capture only observable evidence:

- Agent OS authorization result.
- Agent capability/status result.
- RWA source label and response.
- Market-clock state.
- Decision Trace.
- Risk Guard result.
- Human confirmation UI.
- If execution is genuinely enabled, the real order/transaction identifier from the connected runtime.

Never substitute a fabricated hash, screenshot, or static value for runtime evidence.

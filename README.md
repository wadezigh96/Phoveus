# Phoveus — Agent OS Edition

Submission for the **Binance Agent OS Mini Hackathon, Track A** (build an AI agent using Agent OS).

Phoveus is a prediction market for AI-agent trading calls. This version pulls **live Binance
public market data**, asks an AI agent (Claude) to issue a short-term call on BTC/ETH/BNB, and
lets users predict — with play-money PHOV tokens — whether the agent's call will turn out right.
It's built as the front end for a Binance Agent OS agent: the reasoning and market-data loop is
live today, and the same call is the trigger point for a real Agent OS `place_order` MCP call
once a user's own Binance Agent OS credentials are wired in.

## What's live in this build

- **Live market data** — fetched directly from Binance's public REST API
  (`/api/v3/ticker/24hr`), no API key required.
- **Agent reasoning** — each "Run agent analysis" click sends the live market snapshot to Claude,
  which returns a structured call: symbol, direction (long/short/neutral), confidence, and a short
  rationale.
- **Prediction market loop** — every agent call opens a market; users stake PHOV tokens on whether
  the agent will be right, and it resolves ~20s later against the real price move.

## The Agent OS integration point

The part that plugs into **Binance Agent OS** is the execution step that currently stops at the
UI approval stage. In a full deployment:

1. The agent's call (same JSON shape shown in the terminal) is passed to the
   **Binance Agent OS MCP server** as a `place_order` tool call.
2. Every order still requires explicit user approval before it executes — matching the
   "approve before it executes" pattern Agent OS is built around.
3. Permissions are scoped and revocable at any time from the user's own Agent OS settings, so
   Phoveus never holds custody of funds or standing trade authority.

Example MCP server config for an agent runtime (Claude Code, Cursor, or a self-built agent):

```json
{
  "mcpServers": {
    "binance-agent-os": {
      "url": "https://agent.binance.com/mcp/agentic",
      "auth": "BINANCE_AGENT_OS_TOKEN",
      "scopes": ["market_data:read", "spot_trade:approve_each_order"]
    }
  }
}
```

> Note: this demo does not place real orders — it stops at generating and displaying the call so
> it can run without anyone's live trading credentials. Wiring in `place_order` is a matter of
> adding the MCP server above to the agent's tool list and forwarding the approved call.

## Latency, Reliability & Rate Limits for Complex Strategies (Agent OS vs Traditional API)

This section directly addresses common questions from the community (including #AskBinance posts about Agent OS + MCP + Agentic sub-accounts):

**How does Binance handle latency and reliability when agents execute complex strategies (e.g. arbitrage or multi-leg futures) compared with traditional API trading? Is there priority or special rate limits for agents?**

### Observed performance (public metrics, ~Sep 2026)
- ~190,000 requests/day handled by Agent OS infrastructure
- **P95 response time ≈ 60 ms**
- ~97% success rate on completed requests

These numbers come from Binance’s own public statements about the Agent OS trading path. They indicate a low-latency, high-availability path optimized for continuous agent workloads.

### Key differences vs traditional REST/WebSocket API

| Aspect                  | Traditional API                          | Agent OS (MCP + Agentic sub-account)                  |
|-------------------------|------------------------------------------|-------------------------------------------------------|
| **Latency**             | Depends on your client + network; typical REST round-trips higher under load | Designed for agent loops; reported P95 ~60 ms         |
| **Reliability**         | You manage reconnects, weight tracking, IP bans yourself | Isolated Agentic sub-account + built-in approval flow + Emergency Stop |
| **Rate limits**         | Standard weight + ORDERS limits (per IP / account) | Same underlying exchange limits apply; no public “priority lane” announced |
| **Complex strategies**  | You must orchestrate multi-leg / arbitrage yourself (order sequencing, partial fills, risk) | Agent can reason over multiple legs and issue sequenced `place_order` calls; isolation reduces blast radius |
| **Security model**      | API key on your machine                  | No local API keys; OAuth + scoped permissions + no withdrawal scope |
| **Funding / risk**      | Full account exposure                    | Manual funding of isolated sub-account = hard loss limit |

### Practical recommendations for complex strategies in Phoveus / Agent OS
1. Keep high-frequency or multi-leg logic inside the agent runtime (Claude / Cursor / custom) and only send final approved legs through MCP `place_order`.
2. Use the Agentic sub-account as a hard risk boundary — never fund more than you are willing to lose on the agent.
3. Prefer “approve each order” scope for multi-leg strategies until you have validated the agent’s sequencing logic.
4. Monitor weight usage the same way you would with traditional API; Agent OS does not publicly advertise higher rate limits.
5. For true arbitrage / multi-leg atomicity, combine MCP calls with careful local state tracking (the current Phoveus demo already shows the call → approval → execution hand-off point).

Phoveus is intentionally designed so that the same structured call object produced by the agent can be forwarded to the MCP server with minimal translation. This keeps the latency path short once real credentials are attached.

## Running it

Open `phoveus-agent-os.html` in a browser. No build step, no backend — it's a single static file
that talks to Binance's public API and an LLM endpoint directly from the client.

## Hackathon details

- Event: [Binance Agent OS Mini Hackathon](https://www.binance.com/en/blog/community/8802181509900814931)
- Track: A — best agent built with Agent OS ($20,000 USDC pool)
- Entries close: September 8, 2026, 23:59 UTC

## Disclaimer

All trading calls and PHOV token balances are simulated. Nothing here is financial advice, and no
real orders are placed by this build.

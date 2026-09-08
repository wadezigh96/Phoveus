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
      "url": "https://mcp.binance.com/agent-os",
      "auth": "BINANCE_AGENT_OS_TOKEN",
      "scopes": ["market_data:read", "spot_trade:approve_each_order"]
    }
  }
}
```

> Note: this demo does not place real orders — it stops at generating and displaying the call so
> it can run without anyone's live trading credentials. Wiring in `place_order` is a matter of
> adding the MCP server above to the agent's tool list and forwarding the approved call.

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

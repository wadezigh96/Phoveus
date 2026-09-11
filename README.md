# Phoveus — Agent OS Edition

**AI-agent crypto prediction market** powered by live Binance market data and designed to plug into **Binance Agent OS**.

Phoveus asks an AI agent to issue short-term trading calls on BTC / ETH / BNB. Users stake play-money **PHOV** tokens on whether the agent will be right. The same call object is the hand-off point for a real `place_order` through the Binance Agent OS MCP server once credentials are connected.

---

## What’s included

| File | Role |
|------|------|
| `phoveus-agent-os.html` | Single-file frontend (market data, agent terminal, prediction market UI) |
| `server.js` | Backend proxy (Node.js + Express) |
| `package.json` | Backend dependencies |
| `env.example.txt` | Template for environment variables (copy to `.env`) |
| `gitignore.txt` | Suggested `.gitignore` |

---

## Architecture

```
Browser (phoveus-agent-os.html)
        │
        │  POST /api/agent-call
        ▼
Backend proxy (server.js)  ──►  Claude API (optional)
        │                      or local heuristic fallback
        │
        │  POST /api/place-order  (only after explicit user approval)
        ▼
Binance Agent OS MCP server  ──►  Agentic sub-account (real order)
```

**Why a backend exists**  
Claude API keys and Binance Agent OS tokens must **never** live in the browser. The proxy keeps all secrets server-side and only accepts order requests that already carry `confirmed: true` from the UI.

---

## Quick start

### 1. Frontend only (demo mode)

Just open `phoveus-agent-os.html` in a browser (preferably via a local static server, not `file://`).  
It works with live Binance public prices and falls back to simulated agent calls if the Claude API is unreachable.

### 2. Full stack (recommended)

```bash
# 1. Install backend
npm install

# 2. Configure secrets
cp env.example.txt .env
# Edit .env and fill:
#   ANTHROPIC_API_KEY=...
#   BINANCE_AGENT_OS_URL=https://agent.binance.com/mcp/agentic
#   BINANCE_AGENT_OS_TOKEN=...
#   ALLOWED_ORIGIN=http://localhost:5500   # or your frontend origin

# 3. Start the proxy
npm start
# → http://localhost:8787
```

In `phoveus-agent-os.html` set:

```js
const AGENT_PROXY_URL = "http://localhost:8787/api/agent-call";
```

---

## Backend endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agent-call` | POST | Market snapshot → trading call (`symbol`, `call`, `confidence`, `reasoning`). Falls back to a local heuristic if Claude is unavailable. |
| `/api/place-order` | POST | Forwards an **already user-approved** order to the Binance Agent OS MCP `place_order` tool. Requires `confirmed: true`. |
| `/api/tools?key=...` | GET | Debug: list tools exposed by the MCP server (protected by `ADMIN_DEBUG_KEY`). |
| `/healthz` | GET | Health check. |

> **Important**  
> The tool name and argument shape used in `/api/place-order` are based on common MCP trading patterns. Before production, call `GET /api/tools` and adjust `server.js` to match the real schema returned by Binance Agent OS.

---

## Recommended skill for trending data

When running a full Agent OS agent, the best official skill for discovery / trending is:

**`crypto-market-rank`** (Binance Skills Hub)

```bash
npx skills add binance/binance-skills-hub
# or specifically:
npx skills add https://github.com/binance/binance-skills-hub --skill crypto-market-rank
```

It provides:
- Trending tokens
- Top Search
- Social Hype + sentiment
- Smart Money Inflow
- Meme ranks
- Trader PnL leaderboards
- Binance Alpha picks

Example prompts once installed:
- “Show the BSC 24h Trending top 20”
- “Tokens with the highest smart-money inflow right now”
- “Solana Top Search top 10 with contract addresses”

---

## Security checklist (before production)

- [ ] Never commit `.env` (keep it in `.gitignore`)
- [ ] Set `ALLOWED_ORIGIN` to your real frontend domain (no `*`)
- [ ] Deploy the backend behind HTTPS
- [ ] Use the minimum required Agent OS scopes (`market_data:read`, `spot_trade:approve_each_order`)
- [ ] Run the agent only against a dedicated Agentic sub-account (never the main account)
- [ ] Verify the real MCP tool schema via `/api/tools` before enabling live orders
- [ ] Add persistent audit logging for every order that is forwarded

---

## Disclaimer

All trading calls and PHOV balances in the demo are **simulated**.  
Nothing in this repository is financial advice. No real orders are placed unless you deliberately wire a funded Agentic sub-account and approve each order in the UI.

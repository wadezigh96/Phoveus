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

## Technical Implementation Details

### 1. Market data pipeline (frontend)

```js
// Polls Binance public REST every 15 s
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","BNBUSDT"]
```

- No API key required.
- On success → updates the live ticker strip and stores `latestPrices` + 24h change %.
- On failure (CORS / geo-block / network) → injects static fallback prices so the rest of the demo keeps working.
- Status pill reflects live vs fallback state.

### 2. Agent reasoning pipeline

**Preferred path (backend + Claude)**

1. Frontend sends `{ symbols, prices, changePct }` to `POST /api/agent-call`.
2. Backend builds a concise market summary string.
3. Calls Anthropic Messages API (`claude-sonnet-4-6`) with a strict JSON-only system prompt.
4. Validates the returned object (`symbol ∈ {BTCUSDT,ETHUSDT,BNBUSDT}`, `call ∈ {long,short,neutral}`, numeric confidence).
5. Returns the call to the frontend.

**Fallback path (no Claude key or Claude error)**

```js
// Local heuristic in server.js
function heuristicCall({ prices, changePct }) {
  // pick the symbol with the largest |24h change|
  // > +0.3% → long, < -0.3% → short, otherwise neutral
  // confidence scales with magnitude of the move (50–90)
}
```

Frontend also has its own offline demo fallback (random but realistic calls) so the UI never dead-ends even when the backend is offline.

### 3. Prediction market resolution logic

Each agent call opens a market that auto-resolves after **20 seconds**:

```js
const pctMove = Math.abs(currentPrice - entryPrice) / entryPrice;

if (call === "long"  && price moved up)     → correct
if (call === "short" && price moved down)   → correct
if (call === "neutral" && pctMove < 0.08%)  → correct   // treated as sideways
```

- User can stake 10 PHOV on “Agent will be right” or “Agent will be wrong”.
- Correct prediction → +50 PHOV net; wrong → −10 PHOV.
- Wallet state (balance, correct/wrong counters, agent accuracy %) is kept purely client-side for the demo.

### 4. Order hand-off to Binance Agent OS (MCP)

```
User clicks “Approve order” in UI
        │
        ▼
POST /api/place-order
{
  symbol, side: "BUY"|"SELL", quantity,
  orderType: "MARKET",
  confirmed: true          // hard gate — server rejects anything else
}
        │
        ▼
MCP Client (Streamable HTTP transport)
  Authorization: Bearer <BINANCE_AGENT_OS_TOKEN>
  client.callTool({ name: "place_order", arguments: {...} })
        │
        ▼
Binance Agent OS → Agentic sub-account
```

Key implementation points:
- MCP connection is lazy + singleton (`getMcpClient()`), with automatic retry on failure.
- Rate limiting is applied per IP (in-memory, 10–20 req/min depending on endpoint).
- CORS is locked to `ALLOWED_ORIGIN`.
- The exact tool name / schema is treated as an assumption; `/api/tools` exists so you can inspect the real surface before going live.

### 5. Security model

| Concern | Implementation |
|---------|----------------|
| Secret leakage | All keys stay in `.env` on the server; frontend never sees them |
| Unauthorized orders | `confirmed: true` is mandatory; server refuses otherwise |
| CORS abuse | Explicit origin allow-list |
| Request flooding | Simple per-IP sliding-window rate limiter |
| Blast radius | Designed for a dedicated Agentic sub-account (no withdrawal scope) |
| Debug surface | `/api/tools` protected by `ADMIN_DEBUG_KEY` |

### 6. Data contracts

**Agent call request**
```json
{
  "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  "prices": { "BTCUSDT": 65000.1, "ETHUSDT": 3200.5, "BNBUSDT": 580.2 },
  "changePct": { "BTCUSDT": 1.24, "ETHUSDT": -0.35, "BNBUSDT": 0.12 }
}
```

**Agent call response**
```json
{
  "symbol": "BTCUSDT",
  "call": "long",
  "confidence": 72,
  "reasoning": "Short-term momentum remains positive on rising volume."
}
```

**Place-order request**
```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "quantity": 0.001,
  "orderType": "MARKET",
  "confirmed": true
}
```

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

# Phoveus — Market-Clock Intelligence Agent

**Tokenized-stock market-clock intelligence for BNB Chain.** Phoveus compares on-chain token prices with underlying reference prices, tracks market-open/closed state and reference age, detects divergence, and fails closed during reopening-risk states.

The app also contains a simulated PHOV prediction-market layer for demonstration. Binance Web3 RWA data is read through a server-side signed API proxy. Agent reasoning is guarded by deterministic risk rules and human approval. Binance MCP is treated as an external supported-agent/runtime boundary; the public Vercel app does not claim to be a directly authorized Binance MCP client. Live order execution remains intentionally disabled until an independently verified MCP session and tool schema are available.

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

```text
Browser (phoveus-agent-os.html)
        │
        ├── Market-Clock UI
        ├── Agent Control Plane
        └── Evidence Ledger / Decision Trace
                    │
                    ▼
Backend proxy (server.js)
        │
        ├── Binance Web3 RWA API (signed, read-only)
        ├── deterministic risk guard
        ├── Claude reasoning (optional)
        └── Binance MCP boundary
                └── external supported/user-developed agent runtime
                        └── live execution DISABLED until schema verification
```

### Core agent pipeline

```text
Tokenized Securities Discovery
          ↓
Token Identity
          ↓
Token Audit
          ↓
RWA Research
          ↓
Market Clock
          ↓
Risk Guard
          ↓
Agent Reasoning
          ↓
Human Approval
          ↓
Agentic Wallet / Agent OS adapter
```

**Security boundary:** Binance Web3 credentials, Anthropic credentials, and Agent OS tokens remain server-side. Restricted Binance Web3 responses are handled transparently with clearly labeled demo fallback data; no live price is fabricated.

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
# Edit .env and fill the server-side values documented there.
# Binance MCP authorization is performed by a compatible external agent/runtime;
# do not paste Binance MCP access tokens or cookies into the Phoveus frontend.

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
| `/api/rwa/agent-call` | POST | Tokenized-stock RWA intelligence → guarded WAIT / REVIEW decision. Fails closed when the risk guard is active. |
| `/api/place-order` | POST | Human-approval gate. Currently fail-closed: discovers the MCP order tool/schema but sends no live order until schema is explicitly mapped. |
| `/api/tools?key=...` | GET | Debug: list tools exposed by the MCP server (protected by `ADMIN_DEBUG_KEY`). |
| `/api/rwa/intelligence` | GET | Combines tokenized-stock discovery, prices, market state, divergence and execution guard. |\n| `/api/rwa/decision` | GET | Guarded market-clock decision. |\n| `/api/agent/capabilities` | GET | Phoveus skill registry and execution policy. |\n| `/healthz` | GET | Health/configuration check without secrets. |

> **Important**  
> The order boundary never guesses the Binance MCP schema. A compatible external agent/runtime must establish the Binance MCP session; only then can the actual tool list/schema be inspected. Until that schema is independently verified and mapped, `/api/place-order` sends no order.

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

### 4. Agent OS / wallet execution boundary

Phoveus exposes an Agent OS/MCP compatibility boundary, but the public web app is not claimed as the Binance MCP authorization client. The production safety policy is **fail closed**:

1. User approval must be explicit.
2. The server discovers actual MCP tools with listTools().
3. An order-capable tool must have a usable input schema.
4. Phoveus does not guess tool arguments.
5. Until the discovered schema is explicitly mapped and reviewed, the order endpoint returns without sending an order.

This demonstrates the integration architecture without falsely claiming that live trading is enabled.

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

## Hackathon Submission Readiness

Current alignment with the official BNB Hack: Tokenized Stocks Edition requirements:

| Requirement | Phoveus status |
|---|---|
| Public repository | ✅ GitHub repository is public |
| Deployed link / judge instructions | ⚠️ Live deployment exists, but final judge-path verification is still required |
| Demo video ≤4 minutes | ⚠️ Prepare final submission video |
| bStocks / Ondo / xStocks central | ✅ bStocks is the central RWA platform in the current flow |
| BSC mainnet | ⚠️ RWA integration targets BSC chain 56; live transaction demo is not enabled |
| Spot only | ✅ No perpetual/futures execution path |
| Binance Web3 API | ✅ Signed RWA integration |
| Market/reference price intelligence | ✅ Core feature |
| Agentic Wallet / Wallet Skills | 🟡 Architecture and skill adapter documented; live execution requires verified runtime schema |
| Human approval | ✅ Explicit approval boundary |
| Developer Experience Report | ⚠️ Must be completed manually with real build experience; do not submit an AI-invented report |

### Important limitation

Binance Web3 RWA requests from the current deployment have returned a Binance restricted-location response. Phoveus therefore shows a clearly labeled fallback catalog and fails closed for execution-sensitive intelligence. The fallback does not claim live prices.

For the final submission, do not describe fallback values as live market data. If a live BSC transaction is required for the demonstration, use an eligible environment/account and follow the hackathon's rules rather than attempting to bypass geographic restrictions.

### Final judge path

A judge should be able to understand the product in this order:

1. Open the deployed app.
2. See the Market-Clock Intelligence panel.
3. Run Phoveus Analysis.
4. Inspect the Agent Decision Trace.
5. Inspect the Evidence Ledger.
6. See the Reopening Shock Guard and execution lock.
7. Inspect the Agent Skills / capability pipeline.
8. Use the repository README to understand the Binance Web3 integration and safety boundary.

## Binance MCP supported-agent integration

Binance documents the MCP endpoint `https://agent.binance.com/mcp/agentic` and states that Agent OS works with Claude Code, Cursor, Codex, ChatGPT, and user-developed agents. Phoveus therefore uses an **external MCP client/runtime boundary** rather than claiming that its Vercel web page can start Binance authorization directly.

For the current Phoveus deployment, `/api/agent-os/connect` intentionally fails closed because the previous direct browser OAuth flow produced Binance error `3346001` (unsupported AI agent). This is a compatibility safeguard, not a claim that all user-developed agents are unsupported.

See [`docs/BINANCE_MCP_SUPPORTED_AGENT.md`](docs/BINANCE_MCP_SUPPORTED_AGENT.md) for the exact verification path.

## Agentic Wallet Integration

Phoveus keeps Binance Agent OS MCP as a compatibility adapter, but the primary wallet-execution architecture is the official Binance Agentic Wallet path.

Binance's current Agentic Wallet documentation describes an agent-controlled wallet with MPC Keyless security, API-level user rules, auditability, confirmation for high-risk actions, and support for BSC (56), Ethereum (1), Base (8453), and Solana. Phoveus therefore treats Agentic Wallet as the preferred execution boundary rather than attempting to bypass Binance's supported-agent authorization controls.

### Official Skill installation

Use the Binance Skills Hub from a supported agent environment:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
```

Then connect the supported AI-agent environment to Binance Agentic Wallet according to Binance's current setup flow.

### Phoveus execution contract

```text
RWA Discovery
    ↓
Market Clock
    ↓
Risk Guard
    ↓
Agent Reasoning
    ↓
Human Approval
    ↓
Binance Agentic Wallet
    ↓
BSC / Base / Ethereum / Solana
```

Phoveus does **not** claim that this repository's custom Vercel process is itself an approved Binance Agentic Wallet client. The repository remains fail-closed until an official wallet/agent session is established and its runtime capabilities are verified.

### Current security boundary

- No private key is stored by Phoveus.
- No Agentic Wallet secret is committed to GitHub.
- Human approval remains mandatory in Phoveus.
- RWA states `REOPENING`, `REFERENCE_LAG`, and `DATA_RESTRICTED` keep execution locked.
- The existing MCP order endpoint does not guess tool schemas and does not broadcast an order when the schema is unverified.
- Binance's supported-agent authorization restrictions are not bypassed.

### Verification checklist

- [ ] Install the official Agentic Wallet Skill in the supported agent environment.
- [ ] Authenticate the Agentic Wallet session through Binance's official flow.
- [ ] Verify wallet status and supported chain.
- [ ] Verify balance read.
- [ ] Verify a safe quote/simulation path.
- [ ] Verify human confirmation.
- [ ] Verify transaction/order tracking.
- [ ] Capture runtime evidence before describing execution as live.

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

# Phoveus — Market-Clock Intelligence Agent

**Phoveus delivers the Track A Agent OS workflow with Binance Web3 RWA intelligence, market-clock/risk guards, human approval, and a verified Agentic Wallet runtime.** Phoveus compares on-chain token prices with underlying reference prices, tracks market-open/closed state and reference age, detects divergence, and fails closed during reopening-risk states.

The app also contains a simulated PHOV prediction-market layer for demonstration. It uses Binance public market data and has server-side signed Binance Web3 RWA data routes; the current deployment may return clearly labeled restricted-location fallback data. The public web app remains fail-closed for state-changing execution. One live BSC transaction is independently verified through the supported Agentic Wallet runtime, while Binance MCP live execution is explicitly not claimed.

### Binance capability status

| Capability | Current status |
|---|---|
| Public market data | The frontend reads Binance public market data for its market display and analysis; live availability depends on the runtime/network. |
| Binance Web3 RWA | Signed read routes exist; the current deployment has returned restricted-location responses and uses labeled fallback data. |
| Binance MCP | A client scaffold and `listTools()` discovery path exist. This does not establish authentication or prove which tools the endpoint exposes. |
| Agentic Wallet skill | ✅ Official skill is registered project-level; `baw` is available and runtime checks returned `CONNECTED`, BSC chain 56, and a BSC wallet address in the supported agent environment. This does not mean the public Vercel process owns the wallet session. |
| Execution | 🔒 Fail-closed in the public Phoveus web app; no silent execution. Agentic Wallet state-changing operations remain user-confirmed. |

---

## What’s included

| File | Role |
|------|------|
| `phoveus-agent-os.html` | Frontend: market clock, control plane, decision trace, simulated PHOV layer |
| `phoveus-pipeline.js` | Concept pipeline: discovery → identity → audit → research → clock → guard → reasoning → approval → wallet adapter |
| `phoveus-yield.js` | Read-only RWA dividend yield vs BNB flexible yield. Missing values stay empty. |
| `server.js` | Express API. Runs the pipeline and keeps credentials server-side |
| `skills/` | Stage contracts for the same pipeline |
| `package.json` | Backend dependencies |
| `env.example.txt` | Template for environment variables (copy to `.env`) |
| `.gitignore` | Ignores secrets and local install output |

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
Planned external Agentic Wallet / Agent OS integration (unverified; execution disabled)
```

**Security boundary:** Binance Web3 credentials, Anthropic credentials, and Agent OS tokens remain server-side. Restricted Binance Web3 responses are handled transparently with clearly labeled demo fallback data; no live price is fabricated.

---

## Quick start

### 1. Frontend only

Open `phoveus-agent-os.html` through a local static server, not `file://`.
Without the backend, the analysis path cannot run the RWA pipeline and stays fail-closed. The public ticker strip can still show Binance spot prices, but those prices are context only and are not an execution signal.

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

Open `http://localhost:8787`. The page calls the same-origin pipeline:

```text
POST /api/rwa/agent-call
GET  /api/rwa/intelligence
GET  /api/rwa/decision
```

Do not point analysis at `/api/agent-call`. That legacy crypto route is fail-closed and is not part of the tokenized-stock flow.

---

## Backend endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rwa/agent-call` | POST | Runs the full concept pipeline and returns WAIT or REVIEW plus the stage trace. |
| `/api/rwa/intelligence` | GET | Same pipeline, used by the market-clock panel. |
| `/api/rwa/decision` | GET | Same pipeline, used by the decision and guard panels. |
| `/api/agent/capabilities` | GET | Skill registry in pipeline order, plus the execution policy. |
| `/api/place-order` | POST | Runs tokenized-stock risk checks and can inspect order-tool candidates/schema; always stops before MCP tool invocation or execution. |
| `/api/tools?key=...` | GET | Debug tool list, protected by `ADMIN_DEBUG_KEY`. |
| `/api/rwa/yield` | GET | Read-only RWA dividend yield, BNB flexible yield, and spread. Does not send an order. |
| `/api/pancakeswap/bsc-pools` | GET | Indexed BNB Chain PancakeSwap pool TVL, 24h volume, and source APR; read-only. |
| `/api/venus/usdt-earn` | GET | Read-only Venus USDT supply-market data on BNB Chain. |
| `/healthz` | GET | Health check without secrets. |

> **Important**  
> Tool-name matches are only candidates, not schema verification. Phoveus has no verified authenticated session or verified tool list for this endpoint, and `/api/place-order` always stops before execution. No order is sent.

---

## Technical Implementation Details

### 1. Market data pipeline (frontend)

```js
// Polls Binance public REST every 15 s
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","BNBUSDT"]
```

- No API key required. The browser calls the Phoveus `/api/market` proxy, not Binance directly.
- On success → updates the ticker strip.
- On failure → the strip shows market data restricted. No static price is invented.
- These spot prices are context only. They do not enter the tokenized-stock pipeline.

### 2. Agent reasoning pipeline

The analysis button runs `POST /api/rwa/agent-call`, which executes `phoveus-pipeline.js` in this order:

1. Tokenized securities discovery
2. Token identity on BNB Chain (chain 56). A ticker is never treated as a contract.
3. Token audit context. Missing context fails closed. No audit score is invented.
4. RWA research from Binance Web3 price and underlying-market data.
5. Market clock: OPEN, CLOSED, REOPENING, REFERENCE_LAG, or STALE_REFERENCE.
6. Risk guard. Reopening, lag, stale, missing, or restricted data locks execution.
7. Agent reasoning. The only decisions are WAIT and REVIEW.
8. Human approval. Always required.
9. Agentic Wallet / Agent OS adapter. Schema is unverified, so no order is sent.

Restricted or unavailable Binance Web3 data returns a labeled fallback trace with WAIT. It does not synthesize a price.

### 3. Prediction market layer

The PHOV panel is a simulated demonstration wallet. Analysis does not open a directional crypto market and does not treat a pipeline decision as a trade.

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

**Pipeline request**
```json
{ "symbol": "NVDA", "platformId": "bstock" }
```

**Pipeline response**
```json
{
  "decision": "WAIT",
  "executionLocked": true,
  "orderForwarded": false,
  "rationale": "Live RWA discovery is unavailable. Decision is WAIT and execution remains locked.",
  "stages": [{ "id": "tokenized-securities-discovery", "status": "RESTRICTED" }]
}
```

**Place-order request**
```json
{
  "symbol": "NVDA",
  "platformId": "bstock",
  "side": "BUY",
  "quantity": 1,
  "orderType": "MARKET",
  "confirmed": true
}
```

Crypto symbols such as `BTCUSDT` are rejected. A guarded pipeline result is also rejected, and a clear result still does not send an order until the MCP schema is explicitly mapped.

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
| bStocks / Ondo / xStocks central | ✅ bStocks is the central RWA platform in the current flow |
| Spot only | ✅ No perpetual/futures execution path |
| Binance Web3 API | ✅ Signed RWA integration |
| Market/reference price intelligence | ✅ Core feature |
| Agentic Wallet / Wallet Skills | ⚪ Unverified external integration; no wallet session or execution in Phoveus |
| Human approval | Confirmation flag is checked by the stub; no execution or UI approval path is enabled |

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

## Claude Code MVP connector

The repository includes a project-level `.mcp.json` that configures Binance's MCP endpoint without storing credentials. This is configuration only; it does not prove that Phoveus or the current Codex session authenticated or discovered tools:

```json
{
  "mcpServers": {
    "binance-mcp-server": {
      "type": "http",
      "url": "https://agent.binance.com/mcp/agentic"
    }
  }
}
```

In the latest Codex session check, the endpoint was registered, but authentication remained `Unknown` after an OAuth token-exchange failure. Tool discovery for that connection did not succeed. Do not claim that any endpoint tool is available until an authenticated runtime actually returns it through `tools/list`.

## Binance MCP supported-agent integration

Binance documents the MCP endpoint `https://agent.binance.com/mcp/agentic` and states that Agent OS works with Claude Code, Cursor, Codex, ChatGPT, and user-developed agents. Phoveus therefore uses an **external MCP client/runtime boundary** rather than claiming that its Vercel web page can start Binance authorization directly.

For the current Phoveus deployment, `/api/agent-os/connect` intentionally fails closed because the previous direct browser OAuth flow produced Binance error `3346001` (unsupported AI agent). This is a compatibility safeguard, not a claim that all user-developed agents are unsupported.

See [`docs/BINANCE_MCP_SUPPORTED_AGENT.md`](docs/BINANCE_MCP_SUPPORTED_AGENT.md) for the exact verification path.

## Track A completion checklist

Based on the current Phoveus repository plus the verified supported-agent runtime checks:

| Track A item | Status | Evidence |
|---|---|---|
| Agent OS / agent workflow | ✅ | Market-Clock → RWA Research → Risk Guard → Reasoning → Human Approval pipeline |
| Tokenized-stock / RWA use case | ✅ | bStocks-first RWA workflow and BSC chain 56 context |
| Market-clock intelligence | ✅ | `skills/phoveus-market-clock/SKILL.md` |
| Deterministic risk guard | ✅ | `skills/phoveus-risk-guard/SKILL.md` |
| Human approval boundary | ✅ | `skills/phoveus-execution-approval/SKILL.md` and fail-closed order route |
| Binance token audit/info skills | ✅ | `skills/binance-query-token-audit` and `skills/binance-query-token-info` |
| Tokenized securities skill | ✅ | `skills/binance-tokenized-securities-info` |
| Agentic Wallet skill | ✅ | Project skill registered and recognized by `npx skills list --json` |
| Agentic Wallet runtime | ✅ | `baw wallet status --json` returned `CONNECTED` |
| BSC wallet context | ✅ | `baw wallet chains --json` and `baw wallet address --json` verified chain 56/address |
| Live wallet transaction | ✅ Independently verified | One live BSC transaction verified via `baw wallet tx-history`: chain 56, status `SUCCESS`, time `2026-10-05T18:45:17+07:00`, tx hash `0xbda6a8209c41f28cd93fcd9bcfda4a22b6deafa7f08f04dab9867f13fd1f7b46`. Amount and recipient are not claimed from the CLI verification output. |
| Binance Agentic MCP endpoint | ✅ | Configured as `https://agent.binance.com/mcp/agentic` |
| Venus / vBNB intelligence | 🟡 Supporting | Read-only Comptroller/vBNB checks; supporting DeFi guard, not core Track A requirement |

**Important:** “Agentic Wallet runtime verified” refers to the supported agent environment where `baw` was run. It does **not** claim that the public Vercel web process has direct custody or an embedded wallet session.

## Agentic Wallet Integration

Binance Agentic Wallet is verified in the supported agent environment used with this project. The project skill is registered, the official `baw` CLI is available, `baw wallet status --json` returned `CONNECTED`, and BSC chain 56/address were verified read-only. Phoveus still does not expose wallet secrets to the browser or silently execute state-changing actions.

Binance's Agentic Wallet documentation describes an agent-controlled wallet. The architecture below is a future integration concept, not an implemented Phoveus execution path. Phoveus does not bypass Binance's supported-agent authorization controls.

### Official Skill installation

Use the Binance Skills Hub from a supported agent environment:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
```

Then connect the supported AI-agent environment to Binance Agentic Wallet according to Binance's current setup flow.

### Current verified architecture boundary

The Agentic Wallet runtime is available to the supported agent environment, while the public Phoveus web application remains fail-closed. The wallet session is not embedded into the browser and no private key is stored in the repository.

### Possible future architecture (not implemented)

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

Phoveus does **not** claim that this repository's custom Vercel process is an approved Binance Agentic Wallet client. No wallet session is connected to this app, and execution remains disabled.

### Current security boundary

- No private key is stored by Phoveus.
- No Agentic Wallet secret is committed to GitHub.
- Any future execution integration would require an explicit approval design; the current UI is not an execution approval path.
- RWA states `REOPENING`, `REFERENCE_LAG`, and `DATA_RESTRICTED` keep execution locked.
- The MCP order endpoint does not invoke tools and always stops before execution.
- Binance's supported-agent authorization restrictions are not bypassed.

### Verification checklist

- [x] Install/register the official Agentic Wallet Skill in the supported agent environment.
- [x] Authenticate the Agentic Wallet session through Binance's official flow.
- [x] Verify wallet status and supported chain.
- [x] Verify BSC wallet address read.
- [x] Verify balance read.
- [ ] Verify a safe quote/simulation path.
- [x] Human confirmation policy is documented and state-changing actions remain gated.
- [x] Verify transaction tracking via `baw wallet tx-history`.
- [x] Capture runtime evidence before describing the wallet connection as live/connected.

The remaining unchecked quote/simulation item is deliberately not claimed as complete.

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
Nothing in this repository is financial advice. The public Phoveus web app does not place real orders or directly control the Agentic Wallet. A separate supported Agentic Wallet runtime has independently verified one live BSC transaction; Binance MCP live execution is not claimed.

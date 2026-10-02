# Phoveus Agent Skills

Phoveus runs one pipeline. The skills are stages of that pipeline, not independent trading strategies.

| Order | Skill | Role |
|---|---|---|
| 1 | `binance-tokenized-securities-info` | Discovers a supported tokenized-stock representation. |
| 2 | `binance-query-token-info` | Resolves chain and contract identity. A ticker is never treated as an address. |
| 3 | `binance-query-token-audit` | Checks provider/context before execution. Missing audit context fails closed. |
| 4 | `phoveus-rwa-research` | Loads tokenized-stock price and underlying context. |
| 5 | `phoveus-market-clock` | Classifies open, closed, reopening, reference-lag, and stale-reference states. |
| 6 | `phoveus-risk-guard` | Locks execution for reopening, lag, stale, missing, or restricted data. |
| 7 | Agent reasoning | Returns WAIT or REVIEW only. It does not emit a live order. |
| 8 | `phoveus-execution-approval` | Requires explicit human approval. |
| 9 | `binance-agentic-wallet` | Adapter only. No order is sent until the runtime schema is verified. |

## Runtime order

```
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
Agentic Wallet / Agent OS
```

## Design principle

Phoveus must not treat a price divergence as an automatic trade signal. Missing, restricted, or stale data produces WAIT and leaves execution locked. The public app does not invent a contract, price, audit score, or transaction.

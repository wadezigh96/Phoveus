# Phoveus Agent Skills

Phoveus is organized around four complementary agent skills:

| Skill | Role |
|---|---|
| `phoveus-rwa-research` | Finds and structures tokenized-stock context. |
| `phoveus-market-clock` | Understands open/closed/reopening and reference-price age. |
| `phoveus-risk-guard` | Fails closed when market-state data creates execution risk. |
| `phoveus-execution-approval` | Enforces the human approval boundary before execution. |

## Runtime order

```
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
Binance Agent OS / MCP
```

## Design principle

The skills are complementary, not independent trading strategies. Phoveus should not treat a price divergence as an automatic trade signal. Missing or restricted data must produce a conservative WAIT state.

## Intended Agent OS mapping

- RWA research → RWA Data API context
- Market clock → RWA market/reference data
- Risk guard → deterministic execution policy
- Execution approval → user-approved Agent OS order flow

The exact Binance Agent OS tool names and argument schemas must be discovered from the connected MCP server before any live order is enabled.

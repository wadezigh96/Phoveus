# Binance Agentic Wallet Skill

## Purpose
Provide an agentic wallet capability layer for tokenized-stock workflows when the Binance Agentic Wallet / Skills Hub connection is explicitly enabled.

## Why Phoveus uses it
Phoveus needs a controlled way to move from market-clock intelligence to user-authorized wallet actions. This skill is an execution adapter, not a trading signal.

## Recommended capabilities
- `baw auth signin --json` and `baw auth verify --qrCodeId <qrCodeId> --json` for official wallet sign-in
- `baw wallet status --json` as the source of truth for connection state
- `baw wallet chains --json` and `baw wallet address --json` for network/address verification
- `baw wallet balance --json` for read-only balance verification
- quote / market-order preparation where supported
- transaction preview before execution
- explicit confirmation for high-risk actions
- audit-friendly transaction/result tracking

## Official installation

Install the Binance Agentic Wallet Skill from the official Skills Hub:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
```

The Phoveus Vercel server must not pretend to be the `baw` CLI or invent an Agentic Wallet API. The supported agent environment owns the wallet session; Phoveus consumes verified capability/results through an explicit adapter.

## Phoveus policy
1. Market-Clock and Risk-Guard decisions run first.
2. REOPENING, REFERENCE_LAG, or DATA_RESTRICTED states remain locked.
3. The agent prepares an action; it does not silently execute.
4. User confirmation is required before a state-changing wallet operation.
5. Never expose credentials or private keys to the browser.
6. Prefer the dedicated Agentic Wallet controls and user-defined limits.

## Integration status
This skill is documented as the intended Binance Agentic Wallet adapter. It must not be presented as live-connected until the corresponding Binance Skill/MCP capability is discovered and verified in the deployment.

Official skill reference:
https://www.binance.com/en/skills/detail/binance-web3/binance-agentic-wallet

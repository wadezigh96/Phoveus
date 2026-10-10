# Venus + PancakeSwap utilities in Phoveus

## Available now

Phoveus exposes these public, read-only BNB Chain utilities:

- `GET /api/venus/usdt-earn` — indexed Venus USDT supply-market data.
- `GET /api/pancakeswap/bsc-pools` — indexed PancakeSwap BNB Chain pool TVL, volume, and APR.
- The UI displays both data sources and labels them as indexed/read-only.

These analytics do not prove a user's balance, token allowance, pool-specific risk, or transaction readiness. APY/APR and TVL can change.

## Local Termux Agentic Wallet bridge

The optional bridge is for a local Phoveus backend running on the same Termux device as the `baw` CLI. It is disabled by default and cannot be enabled on Vercel.

Start Phoveus from the repository directory:

```bash
cd ~/Phoveus
PHOVEUS_BAW_PREVIEW_ENABLED=true PORT=8789 npm start
```

Then open `http://localhost:8789` on the same device and use the **Agentic Wallet DeFi Desk** panel.

### Endpoints

- `GET /api/defi/baw/status` — reads `baw wallet status --json` and non-zero BNB Chain balances.
- `POST /api/defi/baw/preview` — calls only `baw defi preview` for supported Venus or PancakeSwap products.

The bridge is restricted to loopback requests, requires the explicit environment flag, and is unavailable when `VERCEL` is set. It uses an argument array, not a shell command string. It does **not** call `baw defi deposit`, `redeem`, `lp-add`, `lp-remove`, or `claim`. A preview can fail because the wallet lacks tokens, the product parameters are invalid, or BAW cannot build the preview; such a failure does not send a transaction.

### Supported preview products

- Venus USDT Earn: deposit and redeem previews.
- PancakeSwap Infinity CAKE/USDT: LP add and LP remove previews. LP removal requires the user's LP NFT ID.

The selected investment IDs and token addresses are allowlisted in the local adapter. BNB Chain (56) is fixed for this initial version.

## Transaction execution boundary

The TermiX listing/registration and a local BAW CLI connection are separate from a verified Phoveus transaction-execution integration. This version does not forward live transactions from the web UI. Any later deposit, redeem, LP add/remove, or claim must run through a verified supported Agentic Wallet/TermiX flow and its explicit user approval. Do not paste private keys or seed phrases into Phoveus, environment variables, or GitHub.

Before enabling the local bridge, understand that the status endpoint exposes the connected local wallet's non-zero balances to the local Phoveus page. Do not expose this backend to your LAN or the public internet.

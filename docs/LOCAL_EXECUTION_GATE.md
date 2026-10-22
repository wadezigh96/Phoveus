# Local Termux BAW Execution

## Status and safety boundary

This is a local CLI flow only. It must never be wired into a public Vercel API route or listen on a LAN interface. The hosted Phoveus app remains read-only. Do not paste wallet secrets, seed phrases, private keys, or authentication output into Phoveus.

The helper does not hard-code live BAW investment IDs. Use the current catalog because product identifiers and availability can change.

## Termux setup / read-only discovery

Install or update the official Binance Agentic Wallet CLI using its official instructions, then complete sign-in through the Binance App. The Phoveus CLI does not sign in on your behalf.

Check current Venus USDT products:

    node phoveus-local-execution-cli.js catalog earn

Check current PancakeSwap LP products:

    node phoveus-local-execution-cli.js catalog lp

These commands only run 'baw wallet status' and 'baw defi investment-list' with BNB Chain ID 56. If the wallet is not CONNECTED, or BAW returns an unexpected JSON schema, the flow stops. Choose an investment ID from the live result; do not copy an ID from old logs or a previous session without re-checking it.

## Local action commands

All operations are interactive. Every action starts by resolving live 'baw defi investment-info' metadata, checking the selected product, checking the BNB Chain RPC chain ID, and running 'baw defi preview'. The entire preview JSON is printed—including balance changes, estimated fees, contract address, and warnings.

Examples (replace values only with those from the live catalog and a position you own):

    node phoveus-local-execution-cli.js execute deposit --investmentId ID --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --amount 1

    node phoveus-local-execution-cli.js execute redeem --investmentId ID --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --amount 1

    node phoveus-local-execution-cli.js execute redeem --investmentId ID --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --ratio 0.5

    node phoveus-local-execution-cli.js execute lp-add --investmentId ID --tokenAddress TOKEN_ADDRESS --amount 1 --priceRange 5 --slippageBps 100

    node phoveus-local-execution-cli.js execute lp-add --investmentId ID --tokenAddress TOKEN_ADDRESS --amount 1 --nftId NFT_ID --slippageBps 100

    node phoveus-local-execution-cli.js execute lp-remove --investmentId ID --nftId NFT_ID --ratio 1 --slippageBps 100

The CLI accepts only four actions: Venus deposit / redeem, and PancakeSwap lp-add / lp-remove. 'claim' is intentionally not implemented. Venus actions are currently restricted to BNB Chain USDT. PancakeSwap actions require a currently listed BNB Chain LP product whose assets are all on the fixed token allowlist. Unsupported products or tokens fail closed.

Before execution, type the exact displayed EXECUTE XXXXXXXX confirmation phrase. That confirmation applies only to the preview in the current process. The approval digest binds the complete normalized action, live product identity, relevant asset metadata, and preview response. The gate rechecks product metadata and chain ID before execution. Preview expiry is 60 seconds. A one-time in-memory preview, one process-wide lock, safe argv construction, and no blind retry are enforced.

## CLI contract

The command builder matches the official BAW documented syntax:

- Preview: 'baw defi preview --action DEPOSIT|REDEEM|LP-ADD|LP-REMOVE ... --binanceChainId 56 --json'
- Execute: 'baw defi deposit|redeem|lp-add|lp-remove ... --json'

The action flag is used only for defi preview; it is not appended to execution subcommands. Commands run via execFile with an argument array, never through a shell. The wrapper does not echo raw stderr/stdout on failures.

## Transaction confirmation

A successful BAW response containing a transaction hash means submitted, not complete. Phoveus validates the hash, confirms the configured RPC reports chain ID 56, polls the read-only BNB Chain receipt endpoint, and checks that the receipt hash matches the submitted hash and has a mined block number. status=0x1 is confirmed success; status=0x0 is confirmed reverted. Missing receipts, output timeouts, mismatches, or unrecognized statuses are never shown as successful and never automatically retried. The default receipt window is up to 15 checks at 2-second intervals; after that the result remains pending.

## Tests and known limits

The test suite uses injected mock BAW responses and mocked receipt readers. It never sends a live transaction. CI passing proves the guard and command builder tests pass, not that a specific account is signed in, a particular product is available, funds/allowances exist, or a live transaction will be accepted by a wallet.

Before any live action, user must check the exact asset, amount, estimated fee, contract address, slippage / position parameters, and every preview warning. Wallet restrictions and daily limits still apply. Any unknown result must be reconciled against the wallet and block explorer before a new action. Do not deploy this flow to Vercel or enable automated trading.

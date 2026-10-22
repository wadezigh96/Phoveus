# Local Termux Execution Gate

## Safety boundary

This feature must remain local to the Termux device. It must not be added to a public Vercel API route and must not listen on a LAN interface. The public Phoveus service remains read-only.

## Required approval protocol

1. Normalize the request to a fixed allowlist of BNB Chain actions and assets. Reject arbitrary contract addresses, arbitrary CLI arguments, unsupported actions, malformed amounts, and any chain other than chain ID 56.
2. Run the Agentic Wallet preview command only. Display the network, assets, exact amount or ratio, fees, balance changes, warnings, product identifier, slippage and other action parameters.
3. Bind approval to a digest of the complete normalized intent and preview response. Any parameter or preview change requires a new preview and a new user approval.
4. Expire previews quickly (60 seconds by default). Consume a preview before starting execution so duplicate requests and replay cannot submit the same action twice.
5. Do not automatically retry an execution after timeout or ambiguous CLI output. Reconcile wallet and chain state first.
6. Require a valid transaction hash and check the receipt using read-only BNB Chain JSON-RPC. Receipt status 1 means confirmed success; status 0 means reverted. Missing receipt means pending or unverified, never success.

## Mainnet test policy

Initial mainnet checks are read-only: verify the configured chain and RPC connectivity and read existing transaction receipts. Do not submit a live deposit, redemption, LP action or claim as a test. Before any real action, run mock tests, verify the installed BAW CLI syntax and response schema, and show the user the complete preview. Only a separate, explicit confirmation for that exact preview can authorize execution.

## Implementation limits

- Approval state should be in memory and invalidated on process restart. Do not use multiple workers for the same local gate.
- Use an argument array with a process API such as execFile, never a shell command string.
- Keep signing and wallet secrets inside the supported Agentic Wallet. Never ask for or store a seed phrase or private key.
- Mock tests do not establish wallet balance, token allowance, product availability, CLI compatibility, or transaction inclusion.
- Do not mark this feature ready until the local UI/CLI is wired to the gate and the end-to-end tests pass.

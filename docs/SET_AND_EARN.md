# Set and Earn — Phoveus qualification plan

Updated: 2026-10-05

Official campaign window: 2026-10-01 through 2026-11-05 12:00 UTC.

## Current target

- Agent: Phoveus
- Category: yield
- Chain: BNB Smart Chain
- Preferred qualification network: BSC Testnet (chain 97) for low-risk execution
- Marketplace target: TermiX (shortlisted by BNB Chain)
- ERC-8004 registry: BSC registry configured in `ERC8004.md`
- Public card: `https://phoveus.vercel.app/.well-known/agent-registration.json`

## Official build gates

1. Register the campaign wallet before campaign tasks.
2. Register Phoveus under ERC-8004 on chain 56 or 97.
3. The registered agent must be owned by the registered campaign wallet.
4. List the agent on one of the nine shortlisted marketplaces.
5. Keep the public agent card reachable and responsive.
6. Receive 3 completed hires from 3 independent wallets that are not owned or funded by the builder.
7. Execute at least 5 qualifying on-chain actions on at least 3 separate days.
8. For a yield agent, the on-chain actions must interact with lending or vault contracts.
9. Keep the repository public and expose the final registry ID and chain.

## Safety boundary

Phoveus remains fail-closed by default. No private key is stored in the repository or Vercel. Registration and any on-chain action require a wallet controlled by the builder and an explicit local signing step.

Do not use circular/self-funded hires, automated multi-wallet activity, or cosmetic activity intended only to satisfy the counter.

## Proposed qualifying execution

Use BSC Testnet first:

- small tBNB supplied to a lending/vault contract;
- redeem/withdraw through the same yield venue;
- repeat only when the action is genuinely part of the service;
- record transaction hashes and dates in the evidence ledger.

Do not count a read-only APR query as an on-chain action.

## Remaining human-controlled steps

- Campaign registration form: the builder must submit the campaign wallet.
- ERC-8004 registration: the builder must sign the registration transaction.
- Marketplace account/listing: the builder must connect the campaign wallet and publish the listing.
- Hires: use real independent participants; do not manufacture qualifying activity.
- Funding: use only testnet funds until the exact marketplace/yield workflow is verified.

## Evidence to retain

- campaign registration confirmation;
- ERC-8004 agentId + registration transaction;
- marketplace listing URL and on-chain listing/hire evidence;
- 3 completed hire transaction/event records from independent wallets;
- 5+ qualifying yield transactions spanning 3+ UTC dates;
- public agent-card HTTP checks;
- final GitHub commit containing registry ID and chain.

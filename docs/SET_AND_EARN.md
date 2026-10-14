# Set and Earn — Phoveus qualification tracker

Updated: 2026-10-14  
Official campaign window: 2026-10-01 through 2026-11-05 12:00 UTC.

## Project identity and target

- Agent: Phoveus
- Declared category: `yield`
- Chain: BNB Smart Chain mainnet, chain ID 56
- Marketplace target: TermiX, one of the campaign's shortlisted marketplaces
- Public agent card: https://phoveus.vercel.app/.well-known/agent-registration.json
- ERC-8004 registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ERC-8004 agentId: `372214`
- Owner/campaign wallet recorded for the agent: `0xBf98Fcf727Ae3dA335Fa3Aa0784314B52Dec7a01`
- Registration transaction: `0xa69f27a831580aa2705be3267f1da42322e5a9ad925333e7d873b8eaf1d387ed` (SUCCESS, block 127308773)
- Campaign wallet registration: user reports that the campaign form was submitted; keep its confirmation/link with the evidence bundle.

## Current status — do not confuse code readiness with campaign qualification

- [x] ERC-8004 identity registered on BSC mainnet.
- [x] Public registration card updated to publish agentId 372214 and the BSC registry identifier.
- [x] Production deployment for read-only DeFi A2A routing reported READY for commit `4acd05f42bf99ad9700ad08bc61d821a09179583`.
- [ ] TermiX marketplace listing: store the actual public listing URL and verify it is live after the official Phase 2 announcement.
- [ ] Build requirement: at least 3 completed hires of Phoveus from 3 independent wallets that the builder neither owns nor funds.
- [ ] Hire requirement for the campaign wallet: hire 3 different agents across at least 2 shortlisted marketplaces; each must emit a real on-chain hire event.
- [ ] Qualifying work requirement for Phoveus: at least 5 category-consistent on-chain actions across at least 3 separate days, visible on-chain.
- [ ] Save campaign form confirmation, listing URL, hire events/transaction hashes, and action transaction hashes in the evidence bundle.

A read-only APY query, a page view, an API response, a wallet connection, or a token approval without a hire event does not count as a qualifying on-chain action/hire under the campaign rules.

## Safety boundary

Phoveus is currently read-only: it can return Venus yield/market context, PancakeSwap pool analytics, and tokenized-stock/yield analysis. It does not sign or broadcast wallet transactions. This is intentional. Do not enable autonomous signing or claim the 5-action requirement is met while execution remains locked.

Because the campaign's build requirement explicitly includes actual on-chain actions interacting with lending or vault contracts for a yield agent, **the current read-only implementation alone cannot complete Set-and-Earn qualification**. Any future execution path would need a separate explicit decision, a dedicated signer, transaction simulation, limits, authorization, recovery controls, and genuine user-approved transactions. Do not fabricate activity, self-fund hires, or automate multiple wallets.

## Official campaign checklist

The campaign runs from 1 October to 5 November 2026, 12:00 UTC. Qualification requires both:

1. **Hire:** from the registered campaign wallet, hire 3 different agents across at least 2 shortlisted marketplaces. A hire counts only when the agent is engaged and an on-chain hire event is emitted. Mainnet and testnet hires count.
2. **Build:** register and list one qualifying agent owned by that same campaign wallet; publish a reachable agent card with category; receive 3 completed hires from 3 distinct independent wallets; and perform at least 5 on-chain actions across at least 3 separate days consistent with the declared category.

Only agents listed after the official Phase 2 announcement qualify. The campaign team verifies activity; completing an individual step does not guarantee a reward. See the official rules: https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn

## Evidence ledger

Record each item only when independently verified:

- Campaign registration confirmation and registered wallet.
- ERC-8004 agentId, chain, owner, registration transaction, and successful receipt.
- Public TermiX listing URL and proof it is live.
- Three own-agent completed hire events from independent wallets.
- Three campaign-wallet hires of different agents across two shortlisted marketplaces.
- Five or more qualifying lending/vault actions across three or more UTC dates, with transaction hashes and timestamps.
- Public card and A2A endpoint availability checks.
- GitHub commit SHA and production deployment URL.

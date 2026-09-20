# Phoveus RWA Research Skill

## Purpose
Give the agent structured context for tokenized stocks instead of relying on a single price.

## Research checklist
- Identify the tokenized asset and platform.
- Compare on-chain and reference prices.
- Inspect market state and reference age.
- Check available liquidity and market information before proposing execution.
- Record the reason for WAIT or REVIEW.
- Preserve a counterfactual event when the guard blocks execution.

## Primary asset scope
bStocks first, with an adapter path for Ondo and xStocks where supported by the Binance Web3 RWA API.

# Phoveus Market-Clock Skill

## Purpose
Understand tokenized-stock market state before an agent considers an action.

## Inputs
- RWA token price
- underlying/reference price
- market status
- next open/close time
- snapshot age

## Actions
1. Calculate divergence using the token/reference price relationship.
2. Classify the state as OPEN, CLOSED, REOPENING, or REFERENCE_LAG.
3. If the state can invalidate a current spread, return an execution lock.
4. Never invent missing market timestamps or prices.

## Safety
This skill is informational/risk-control logic. It does not authorize trades.

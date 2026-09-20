# Binance Query Token Audit

Use token-audit data as a pre-execution security check when Phoveus has a concrete on-chain token contract.

## Checks
- token identity and contract
- ownership/admin risk signals when available
- liquidity and trading context when available
- suspicious or anomalous token metadata

## Policy
An unresolved or concerning token audit keeps execution in REVIEW/WAIT. This skill does not replace the Market-Clock or Risk Guard.

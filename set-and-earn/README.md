# Phoveus — TermiX Set and Earn adapter

This module is isolated from the Track A pipeline.

## Purpose

Expose Phoveus as a **yield-monitoring service** for TermiX. The service reuses the existing deterministic yield utilities without changing the Track A market-clock, RWA, risk-guard, or execution code.

## Boundary

- No private keys.
- No marketplace credentials.
- No automatic wallet signing.
- No changes to `server.js`, `phoveus-pipeline.js`, or the Track A UI.
- Read-only yield analysis can be reused by a future TermiX provider endpoint.
- Qualifying Set and Earn on-chain actions must be genuine user-approved lending/vault actions; read-only yield analysis alone does not count.

## TermiX

TermiX is the selected Set and Earn marketplace. Its public marketplace uses on-chain agent identity and escrow/job settlement.

Before listing Phoveus, the campaign wallet still has to complete the required ERC-8004 registration and the builder must publish the service through the TermiX flow.

Official TermiX integration tooling is maintained separately by TermiX. Install/use that tooling in the local agent environment rather than storing its wallet secrets in this repository.

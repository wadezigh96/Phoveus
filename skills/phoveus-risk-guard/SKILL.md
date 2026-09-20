# Phoveus Reopening Risk Guard

## Purpose
Prevent the agent from treating stale-reference divergence as ordinary directional alpha.

## Rules
- REOPENING => execution locked.
- REFERENCE_LAG => execution locked.
- DATA_RESTRICTED => fail closed and WAIT.
- Missing reference price => no divergence claim.
- Missing market state => no automatic execution.

## Output
Return:
- decision: WAIT or REVIEW
- executionLocked: boolean
- rationale: concise reason

The guard is deterministic and auditable.

/**
 * TermiX-facing yield analysis adapter.
 *
 * This file is intentionally independent of the Track A request pipeline.
 * It contains no wallet signer and performs no state-changing transaction.
 */

import {
  compareRwaBnbYield,
  readUnderlyingYield,
  readBnbFlexibleApr,
} from "../../phoveus-yield.js";

export function analyzeYieldForTermix({ underlyingProfile, bnbFlexiblePayload }) {
  const rwa = readUnderlyingYield(underlyingProfile);
  const bnb = readBnbFlexibleApr(bnbFlexiblePayload);
  const comparison = compareRwaBnbYield({
    rwaYieldPct: rwa.dividendYieldPct,
    bnbYieldPct: bnb.aprPct,
  });

  return {
    agent: "Phoveus",
    marketplace: "TermiX",
    category: "yield",
    network: "bsc",
    chainId: 56,
    analysisStatus:
      rwa.dividendYieldPct === null || bnb.aprPct === null
        ? "incomplete"
        : "complete",
    missingInputs: [
      ...(rwa.dividendYieldPct === null ? ["rwaDividendYield"] : []),
      ...(bnb.aprPct === null ? ["bnbFlexibleApr"] : []),
    ],
    result: {
      rwaYieldPct: rwa.dividendYieldPct,
      bnbYieldPct: bnb.aprPct,
      spreadPct: comparison.spreadPct,
      relation: comparison.relation,
    },
    safety: {
      readOnly: true,
      executionUnlocked: false,
      requiresExplicitApproval: true,
    },
  };
}

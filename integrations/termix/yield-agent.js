/**
 * TermiX-facing yield analysis adapter.
 *
 * This file is intentionally independent of the Track A request pipeline.
 * It contains no wallet signer and performs no state-changing transaction.
 */

import {
  compareRwaBnbYield,
  readUnderlyingYield,
  readBnbFlexibleApy,
} from "../../phoveus-yield.js";

export function analyzeYieldForTermix({ underlyingProfile, bnbFlexiblePayload }) {
  const rwa = readUnderlyingYield(underlyingProfile);
  const bnb = readBnbFlexibleApy(bnbFlexiblePayload);
  const comparison = compareRwaBnbYield({
    rwaYieldPct: rwa.dividendYieldPct,
    bnbYieldPct: bnb.apyPct,
  });
  const complete = rwa.dividendYieldPct !== null && bnb.apyPct !== null;

  return {
    agent: "Phoveus",
    marketplace: "TermiX",
    category: "yield",
    network: "bsc",
    chainId: 56,
    analysisStatus: complete ? "complete" : "incomplete",
    missingInputs: [
      ...(rwa.dividendYieldPct === null ? ["rwaDividendYield"] : []),
      ...(bnb.apyPct === null ? ["bnbFlexibleApy"] : []),
    ],
    result: {
      rwaYieldPct: rwa.dividendYieldPct,
      rwaYieldType: "UNDERLYING_STOCK_DIVIDEND_YIELD",
      bnbYieldPct: bnb.apyPct,
      bnbYieldType: "APY",
      bnbProductId: bnb.productId,
      spreadPct: comparison.spreadPct,
      relation: comparison.relation,
    },
    sources: {
      rwa: rwa.sourceField,
      bnb: bnb.sourceField,
    },
    safety: {
      readOnly: true,
      executionUnlocked: false,
      requiresExplicitApproval: true,
      orderForwarded: false,
    },
  };
}

/**
 * Unified read-only DeFi task router.
 * Routes Venus deposit intents and PancakeSwap staking/liquidity intents to
 * existing adapters. It gathers market context; it never signs or broadcasts.
 */

const SAFE_SYMBOL = /^[A-Z0-9]{2,15}$/;

export function resolveDefiTask(input = {}) {
  const message = String(input.message || input.task || "").trim().toLowerCase();
  const explicitProtocol = String(input.protocol || "").trim().toLowerCase();
  let protocol = explicitProtocol;

  if (!protocol) {
    if (/\b(venus)\b/.test(message)) protocol = "venus";
    else if (/pancake\s*swap|pancakeswap|\b(liquidity|staking|farm|pool)\b/.test(message)) {
      protocol = "pancakeswap";
    }
  }

  if (!["venus", "pancakeswap"].includes(protocol)) {
    throw new Error("Specify Venus or PancakeSwap so the task uses the correct DeFi integration.");
  }

  let action = String(input.action || "").trim().toLowerCase();
  if (!action) {
    if (/stake|staking|farm|liquidity/.test(message)) action = "stake";
    else if (/deposit|supply|lend/.test(message)) action = "deposit";
    else action = "analyze";
  }
  if (!["analyze", "deposit", "stake", "liquidity"].includes(action)) {
    throw new Error("Supported actions are analyze, deposit, stake, or liquidity.");
  }

  if (protocol === "venus" && ["stake", "liquidity"].includes(action)) {
    action = "deposit";
  }
  if (protocol === "pancakeswap" && action === "deposit") {
    action = "stake";
  }

  const cmcSymbol = String(input.cmcSymbol || input.symbol || (protocol === "pancakeswap" ? "CAKE" : "BNB")).trim().toUpperCase();
  if (!SAFE_SYMBOL.test(cmcSymbol)) throw new Error("Invalid CMC symbol.");

  return {
    protocol,
    action,
    cmcSymbol,
    amountBnb: input.amountBnb == null ? null : String(input.amountBnb),
  };
}

export async function runDefiTask(input, adapters) {
  const task = resolveDefiTask(input);
  const sourceResults = {};
  const read = async (key, fn) => {
    try {
      sourceResults[key] = { status: "ok", data: await fn() };
    } catch {
      sourceResults[key] = { status: "unavailable", data: null };
    }
  };

  const jobs = [
    read("cmc", () => adapters.getCmcQuote({ symbol: task.cmcSymbol })),
  ];

  if (task.protocol === "pancakeswap") {
    jobs.push(read("pancakeswap", () => adapters.readPancakeSwapBscPools()));
  } else {
    jobs.push(read("venus", () => adapters.readVenusBnbMarket()));
    jobs.push(read("venusUsdtEarn", () => adapters.readVenusUsdtEarn()));
  }
  await Promise.all(jobs);

  let preflight = {
    status: "not_requested",
    executionAllowed: false,
    transactionHash: null,
    reason: "Read-only market context only; no wallet transaction was prepared or sent.",
  };

  if (task.protocol === "venus" && task.action === "deposit" && task.amountBnb !== null) {
    try {
      preflight = {
        status: "assessment_only",
        ...adapters.assessVenusDeposit({
          amountBnb: task.amountBnb,
          chainId: "56",
          marketAddress: adapters.venusMarketAddress,
          signerAvailable: false,
          explicitApproval: false,
          emergencyStop: false,
        }),
      };
    } catch (error) {
      preflight = {
        status: "rejected",
        executionAllowed: false,
        transactionHash: null,
        reason: error instanceof Error ? error.message : "Deposit assessment failed.",
      };
    }
  }

  return {
    ok: Object.values(sourceResults).some((source) => source.status === "ok"),
    task: { protocol: task.protocol, action: task.action, chainId: 56, symbol: task.cmcSymbol },
    sources: sourceResults,
    preflight,
    executionLocked: true,
    executionAllowed: false,
    orderForwarded: false,
    transactionBuilt: false,
  };
}

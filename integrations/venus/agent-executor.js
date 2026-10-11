/**
 * Phoveus Venus agent execution gate.
 * Mainnet transaction signing and broadcasting are NOT implemented.
 * Fail closed until a dedicated, authorized agent signer is integrated.
 */

export const VENUS_AGENT_CONFIG = Object.freeze({
  chainId: "56",
  marketAddress: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
  maxDepositWei: 10000000000000000n, // 0.01 BNB
  mode: "simulation-only",
});

export function assessVenusDeposit({
  amountBnb,
  chainId,
  marketAddress,
  signerAvailable = false,
  explicitApproval = false,
  emergencyStop = false,
} = {}) {
  const amount = String(amountBnb ?? "");

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new Error("Invalid BNB amount.");
  }

  const [whole, fraction = ""] = amount.split(".");
  const amountWei =
    BigInt(whole) * 10n ** 18n +
    BigInt((fraction + "0".repeat(18)).slice(0, 18));

  if (amountWei <= 0n) {
    throw new Error("Deposit amount must be greater than zero.");
  }

  if (amountWei > VENUS_AGENT_CONFIG.maxDepositWei) {
    throw new Error("Deposit exceeds the 0.01 BNB per-transaction limit.");
  }

  const checks = {
    correctChain: String(chainId) === VENUS_AGENT_CONFIG.chainId,
    correctMarket:
      String(marketAddress || "").toLowerCase() ===
      VENUS_AGENT_CONFIG.marketAddress.toLowerCase(),
    signerAvailable: signerAvailable === true,
    explicitApproval: explicitApproval === true,
    emergencyStopOff: emergencyStop === false,
  };

  return {
    agent: "Phoveus",
    protocol: "Venus",
    amountBnb: amount,
    chainId: VENUS_AGENT_CONFIG.chainId,
    marketAddress: VENUS_AGENT_CONFIG.marketAddress,
    checks,
    executionAllowed: false,
    mode: VENUS_AGENT_CONFIG.mode,
    transactionHash: null,
    reason: "Execution remains locked: signer integration and independent Mainnet safety checks are not implemented.",
  };
}

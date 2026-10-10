/**
 * Local-only Binance Agentic Wallet CLI bridge for Phoveus.
 *
 * This adapter is deliberately unavailable on Vercel and non-loopback hosts.
 * It supports wallet status/balance reads and DeFi previews only. It never
 * invokes deposit/redeem/lp-add/lp-remove/claim transaction commands.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHAIN_ID = "56";
const VENUS_USDT_ID = "5b77bfd8d8f7c18e9ee0d8f331c4d78f56744eed8addbe2e9970c0ef37e763cb";
const PANCAKESWAP_INFINITY_CAKE_USDT_ID = "d31aa56a981440427cc25f1ae285c99cfa59ac0a2e5b99afab516c460f682f36";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";

function isLoopback(value) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(value || "").toLowerCase());
}

export function isLocalBawBridgeEnabled(req) {
  if (process.env.VERCEL || process.env.PHOVEUS_BAW_PREVIEW_ENABLED !== "true") return false;
  const remote = req?.socket?.remoteAddress;
  const hostname = String(req?.headers?.host || "").split(":")[0].toLowerCase();
  return isLoopback(remote) && ["localhost", "127.0.0.1"].includes(hostname);
}

function parseJsonOutput(stdout, stderr = "") {
  const candidates = [String(stdout || "").trim(), String(stderr || "").trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {}
    }
  }
  throw new Error("BAW returned no parseable JSON response.");
}

async function runBaw(args) {
  try {
    const { stdout, stderr } = await execFileAsync("baw", args, {
      timeout: 25000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    return parseJsonOutput(stdout, stderr);
  } catch (error) {
    const parsed = parseJsonOutput(error?.stdout, error?.stderr);
    if (parsed) return parsed;
    throw new Error("BAW CLI command failed. Check the local BAW connection and CLI output.");
  }
}

export async function readLocalBawWallet() {
  const [status, balances] = await Promise.all([
    runBaw(["wallet", "status", "--json"]),
    runBaw(["wallet", "balance", "--binanceChainId", CHAIN_ID, "--json"]),
  ]);
  return {
    ok: status?.success === true && balances?.success === true,
    source: "local-baw-agentic-wallet-cli",
    chainId: CHAIN_ID,
    status: status?.data?.status || "UNKNOWN",
    balances: Array.isArray(balances?.data) ? balances.data : [],
    executionLocked: true,
    transactionBroadcast: false,
    note: "Local Agentic Wallet status and balance read only. No transaction was prepared, signed, or sent.",
  };
}

function validAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) return null;
  return Number(text) > 0 ? text : null;
}

function validRatio(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0?\.\d+|1(?:\.0+)?)$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && number <= 1 ? text : null;
}

function validPositiveInteger(value, max = 1000000000) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 && number <= max ? text : null;
}

function validateRequest(input) {
  const action = String(input?.action || "");
  const venue = String(input?.venue || "");
  if (!["deposit", "redeem", "lp-add", "lp-remove"].includes(action)) {
    throw new Error("Unsupported preview action.");
  }

  let investmentId;
  let tokenAddress;
  if (venue === "venus-usdt") {
    if (!["deposit", "redeem"].includes(action)) throw new Error("Venus supports deposit/redeem preview in this form.");
    investmentId = VENUS_USDT_ID;
    tokenAddress = USDT;
  } else if (venue === "pancakeswap-infinity-cake-usdt") {
    if (!["lp-add", "lp-remove"].includes(action)) throw new Error("PancakeSwap Infinity supports LP add/remove preview in this form.");
    investmentId = PANCAKESWAP_INFINITY_CAKE_USDT_ID;
    tokenAddress = USDT;
  } else {
    throw new Error("Choose a supported Venus or PancakeSwap product.");
  }

  const args = ["defi", "preview", "--action", action, "--investmentId", investmentId, "--binanceChainId", CHAIN_ID, "--json"];
  if (action === "deposit") {
    const amount = validAmount(input?.amount);
    if (!amount) throw new Error("Enter a valid positive amount.");
    args.push("--tokenAddress", tokenAddress, "--amount", amount);
  } else if (action === "redeem") {
    const amount = input?.amount ? validAmount(input.amount) : null;
    const ratio = input?.ratio ? validRatio(input.ratio) : null;
    if (!amount && !ratio) throw new Error("Enter either a positive amount or a ratio from 0 to 1.");
    if (amount) args.push("--tokenAddress", tokenAddress, "--amount", amount);
    else args.push("--ratio", ratio);
  } else if (action === "lp-add") {
    const amount = validAmount(input?.amount);
    const priceRange = validPositiveInteger(input?.priceRange, 100);
    const slippage = String(input?.slippageBps || "auto");
    if (!amount) throw new Error("Enter a valid positive USDT amount.");
    if (!priceRange) throw new Error("Price range must be an integer from 1 to 100 percent.");
    if (slippage !== "auto" && !/^[1-4]?[0-9]{1,3}$/.test(slippage)) throw new Error("Slippage must be auto or a positive basis-point value.");
    if (slippage !== "auto" && (Number(slippage) < 1 || Number(slippage) > 4999)) throw new Error("Slippage must be between 1 and 4999 bps.");
    args.push("--tokenAddress", tokenAddress, "--amount", amount, "--priceRange", priceRange, "--slippageBps", slippage);
  } else if (action === "lp-remove") {
    const nftId = validPositiveInteger(input?.nftId);
    const ratio = validRatio(input?.ratio);
    const slippage = String(input?.slippageBps || "auto");
    if (!nftId || !ratio) throw new Error("LP remove requires a positive NFT ID and a ratio from 0 to 1.");
    if (slippage !== "auto" && (!/^\d+$/.test(slippage) || Number(slippage) < 1 || Number(slippage) > 4999)) throw new Error("Slippage must be auto or between 1 and 4999 bps.");
    args.push("--nftId", nftId, "--ratio", ratio, "--slippageBps", slippage);
  }
  return { action, venue, args };
}

export async function previewLocalBawDefi(input) {
  const request = validateRequest(input);
  const result = await runBaw(request.args);
  return {
    ok: result?.success === true,
    action: request.action,
    venue: request.venue,
    chainId: CHAIN_ID,
    source: "local-baw-agentic-wallet-cli",
    preview: result,
    executionLocked: true,
    transactionBuilt: false,
    transactionBroadcast: false,
    note: "Preview only. Phoveus does not call transaction commands; use the supported Agentic Wallet/TermiX approval flow for any later action.",
  };
}

export const LOCAL_BAW_DEFI_CONFIG = Object.freeze({
  chainId: CHAIN_ID,
  venues: ["venus-usdt", "pancakeswap-infinity-cake-usdt"],
  previewOnly: true,
});

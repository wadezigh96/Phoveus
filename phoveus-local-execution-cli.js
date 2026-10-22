#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import {
  createLocalExecutionGate,
  readBscChainId,
  readBscReceipt,
  SAFE_BSC_TOKENS,
} from "./phoveus-local-execution.js";

const execFileAsync = promisify(execFile);
const LOCK_PATH = path.join(os.tmpdir(), "phoveus-baw-live-execution.lock");
const BAW_BIN = process.env.PHOVEUS_BAW_BIN || "baw";
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function usage() {
  console.log([
    "Phoveus local BAW execution — Termux only; never a Vercel API.",
    "",
    "Read-only transaction history:",
    "  node phoveus-local-execution-cli.js history",
    "  node phoveus-local-execution-cli.js history --tx 0xYOUR_TRANSACTION_HASH",
    "",
    "Read-only catalog:",
    "  node phoveus-local-execution-cli.js catalog earn",
    "  node phoveus-local-execution-cli.js catalog lp",
    "",
    "Preview + explicit confirmation + execution:",
    "  node phoveus-local-execution-cli.js execute deposit --investmentId ID --tokenAddress USDT_ADDRESS --amount 1",
    "  node phoveus-local-execution-cli.js execute redeem --investmentId ID --tokenAddress USDT_ADDRESS --amount 1",
    "  node phoveus-local-execution-cli.js execute redeem --investmentId ID --tokenAddress USDT_ADDRESS --ratio 0.5",
    "  node phoveus-local-execution-cli.js execute lp-add --investmentId ID --tokenAddress TOKEN_ADDRESS --amount 1 --priceRange 5",
    "  node phoveus-local-execution-cli.js execute lp-add --investmentId ID --tokenAddress TOKEN_ADDRESS --amount 1 --nftId 123",
    "  node phoveus-local-execution-cli.js execute lp-remove --investmentId ID --nftId 123 --ratio 1",
    "",
    "Only BSC (chain ID 56), live BAW product metadata, and the fixed token allowlist are accepted.",
    "The CLI prints the complete preview and requires a fresh confirmation for that preview.",
    "No wallet keys or seed phrases are requested or stored.",
  ].join("\n"));
}

async function runBaw(args) {
  let result;
  try {
    result = await execFileAsync(BAW_BIN, args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1_048_576,
      windowsHide: true,
      shell: false,
    });
  } catch (error) {
    // Transaction commands may time out after submission; never expose raw CLI output.
    if (error?.code === "ETIMEDOUT") throw new Error("BAW command timed out. Treat transaction outcome as unknown; reconcile wallet/chain before retrying.");
    if (error?.code === "ENOENT") throw new Error("The 'baw' CLI was not found. Install/verify Binance Agentic Wallet CLI first.");
    throw new Error("BAW command failed or returned an unexpected exit status. Do not retry a transaction without reconciliation.");
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("BAW did not return valid JSON. Action blocked; inspect CLI setup without repeating a transaction.");
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.success !== "boolean") {
    throw new Error("BAW JSON schema is unexpected. Action blocked.");
  }
  return parsed;
}

async function walletPreflight() {
  // Versions verified against the official Skills Hub metadata at implementation time.
  const skill = await runBaw([
    "skill-check", "--skill-name", "binance-agentic-wallet",
    "--current-version", "1.13.0", "--json",
  ]);
  if (skill.success !== true || skill.data?.needUpdateSkill !== false) {
    throw new Error("BAW skill version is outdated or unknown. Update and re-review the official skill before proceeding.");
  }
  const cli = await runBaw(["cli-check", "--required-version", "1.11.0", "--json"]);
  if (cli.success !== true || cli.data?.needUpdateCli !== false) {
    throw new Error("BAW CLI version is too old or cannot be verified. Update the official CLI before proceeding.");
  }
  const response = await runBaw(["wallet", "status", "--json"]);
  if (response.success !== true || response.data?.status !== "CONNECTED") {
    throw new Error("Binance Agentic Wallet is not connected. Sign in through the official Binance App flow before proceeding.");
  }
}

function parseFlags(tokens, allowed) {
  const values = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];
    if (!allowed.includes(key)) throw new Error("Unsupported option: " + key);
    if (Object.hasOwn(values, key)) throw new Error("Duplicate option: " + key);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + key);
    values[key] = value;
    index += 1;
  }
  return values;
}

function safeProductRows(data, type) {
  const rows = Array.isArray(data?.list) ? data.list : [];
  return rows.filter((row) => {
    if (String(row?.binanceChainId ?? "") !== "56") return false;
    if (!ID_PATTERN.test(String(row?.investmentId ?? ""))) return false;
    const protocol = String(row?.protocolName ?? "");
    const investType = String(row?.investType ?? "");
    if (type === "earn") {
      return /venus/i.test(protocol) && investType.toLowerCase() === "earn";
    }
    return /pancake/i.test(protocol) && investType.toLowerCase() === "liquiditypool";
  }).map((row) => ({
    investmentId: row.investmentId,
    investmentName: row.investmentName ?? null,
    protocolName: row.protocolName,
    defiProtocolId: row.defiProtocolId,
    binanceChainId: row.binanceChainId,
    investType: row.investType,
    investable: row.investable ?? null,
    apyDisplay: row.apyDisplay ?? null,
    tvl: row.tvl ?? null,
  }));
}

async function history(rawFlags) {
  const flags = parseFlags(rawFlags, ["--tx"]);
  const txHash = flags["--tx"];
  if (txHash != null && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("A valid 32-byte EVM transaction hash is required.");
  await walletPreflight();
  const args = ["wallet", "tx-history", "--binanceChainId", "56", "--size", "50"];
  if (txHash) args.push("--tx", txHash);
  args.push("--json");
  const response = await runBaw(args);
  if (response.success !== true || !response.data || typeof response.data !== "object") {
    throw new Error("BAW transaction history could not be verified.");
  }
  console.log(JSON.stringify({
    readOnly: true,
    chainId: "56",
    lookup: txHash ? "specific transaction hash" : "recent transaction history",
    result: response.data,
    note: "Wallet history is an indexer view. For final success/revert, verify the exact BSC receipt by transaction hash and wait for confirmations.",
  }, null, 2));
}

async function catalog(type) {
  if (type !== "earn" && type !== "lp") throw new Error("Catalog type must be 'earn' or 'lp'.");
  await walletPreflight();
  const investType = type === "earn" ? "Earn" : "LiquidityPool";
  const args = ["defi", "investment-list", "--investType", investType, "--binanceChainId", "56", "--page", "1", "--size", "100"];
  if (type === "earn") args.push("--contractAddresses", SAFE_BSC_TOKENS.USDT);
  args.push("--json");
  const data = await runBaw(args);
  if (data.success !== true) throw new Error("BAW investment catalog query failed.");
  const products = safeProductRows(data.data, type);
  console.log(JSON.stringify({
    readOnly: true,
    chainId: "56",
    catalog: type,
    count: products.length,
    products,
    note: "Product IDs come from the live BAW catalog. Before any execution, the selected product is revalidated using investment-info.",
  }, null, 2));
}

async function openOwnedLock() {
  const handle = await open(LOCK_PATH, "wx", 0o600);
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  return handle;
}

async function acquireLock() {
  try {
    return await openOwnedLock();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    // Recover a stale lock only if its recorded process is definitely gone.
    let owner;
    try { owner = JSON.parse(await readFile(LOCK_PATH, "utf8")); } catch {}
    const pid = Number(owner?.pid);
    let stale = Number.isSafeInteger(pid) && pid > 0;
    if (stale) {
      try { process.kill(pid, 0); stale = false; } catch (probeError) {
        stale = probeError?.code === "ESRCH";
      }
    }
    if (!stale) throw new Error("Another Phoveus execution session is active. Do not start a second transaction.");
    try { await unlink(LOCK_PATH); } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") throw new Error("Could not safely recover the stale local lock.");
    }
    try {
      return await openOwnedLock();
    } catch {
      throw new Error("Another Phoveus execution session acquired the lock. Stop here.");
    }
  }
}

async function executeAction(action, rawFlags) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Live execution requires an interactive terminal so explicit confirmation can be obtained.");
  }
  const allowedFlags = ["--investmentId", "--tokenAddress", "--amount", "--ratio", "--nftId", "--priceRange", "--slippageBps"];
  const flags = parseFlags(rawFlags, allowedFlags);
  if (!ID_PATTERN.test(String(flags["--investmentId"] ?? ""))) throw new Error("A valid --investmentId from the live catalog is required.");
  for (const [key, value] of Object.entries(flags)) {
    if (key === "--tokenAddress" && !ADDRESS_PATTERN.test(value)) throw new Error("Invalid token address.");
    if (!["--tokenAddress", "--investmentId"].includes(key) && !/^[A-Za-z0-9._-]+$/.test(value)) {
      throw new Error("Invalid characters in " + key + ".");
    }
  }

  const lock = await acquireLock();
  try {
    await walletPreflight();
    const chainId = await readBscChainId();
    if (chainId !== "56") throw new Error("RPC chain mismatch. No transaction was sent.");

    const input = {
      action,
      investmentId: flags["--investmentId"],
      tokenAddress: flags["--tokenAddress"],
      amount: flags["--amount"],
      ratio: flags["--ratio"],
      nftId: flags["--nftId"],
      priceRange: flags["--priceRange"],
      slippageBps: flags["--slippageBps"],
    };
    const gate = createLocalExecutionGate({
      runner: runBaw,
      receiptReader: readBscReceipt,
      chainReader: readBscChainId,
    });
    const preview = await gate.preview(input);
    console.log("\n=== REVIEW THIS EXACT BNB CHAIN PREVIEW ===");
    console.log(JSON.stringify(preview, null, 2));
    console.log("\nNothing has been executed yet.");
    console.log("Preview expires at Unix ms: " + preview.expiresAt);
    console.log("To authorize only this preview, type: EXECUTE " + preview.previewId.slice(-8).toUpperCase());

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await rl.question("> "); } finally { rl.close(); }
    const expected = "EXECUTE " + preview.previewId.slice(-8).toUpperCase();
    if (answer.trim() !== expected) {
      console.log("Cancelled. No transaction command was run.");
      return;
    }

    const result = await gate.execute({
      previewId: preview.previewId,
      approvalDigest: preview.approvalDigest,
      confirm: true,
    });
    console.log("\n=== EXECUTION / RECEIPT RESULT ===");
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      console.log("Receipt confirms success on BNB Smart Chain. Tx hash: " + result.txHash);
    } else {
      console.log("Not confirmed as successful. Do not retry automatically; reconcile the transaction hash and wallet state first.");
    }
  } finally {
    await lock.close().catch(() => {});
    await unlink(LOCK_PATH).catch(() => {});
  }
}

async function main() {
  const [command, arg, ...rest] = process.argv.slice(2);
  if (command === "catalog") return catalog(arg);
  if (command === "history") return history([arg, ...rest].filter(Boolean));
  if (command === "execute") return executeAction(arg, rest);
  usage();
  if (command) throw new Error("Unknown command.");
}

main().catch((error) => {
  console.error("Phoveus local execution stopped: " + String(error?.message || "unknown error"));
  process.exitCode = 1;
});

import { readPancakeSwapBscPools } from "../../phoveus-pancakeswap.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed.", readOnly: true, executionLocked: true });
  }

  try {
    return res.status(200).json(await readPancakeSwapBscPools());
  } catch {
    return res.status(502).json({
      ok: false,
      protocol: "PancakeSwap",
      error: "PancakeSwap BNB Chain pool analytics are temporarily unavailable.",
      readOnly: true,
      executionLocked: true,
      transactionBuilt: false,
      transactionBroadcast: false,
    });
  }
}

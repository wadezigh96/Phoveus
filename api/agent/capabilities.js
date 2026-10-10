export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const skills = [
    {
      id: "binance-tokenized-securities-info",
      name: "Tokenized Securities Discovery",
      role: "Resolves supported tokenized-stock representations and providers.",
    },
    {
      id: "binance-query-token-info",
      name: "Token Identity",
      role: "Resolves token, contract, and chain identity before on-chain actions.",
    },
    {
      id: "binance-query-token-audit",
      name: "Token Audit",
      role: "Adds asset-security context before a user considers execution.",
    },
    {
      id: "pancakeswap-bsc-pool-analytics",
      name: "PancakeSwap BNB Chain Pool Analytics",
      role: "Reads indexed BSC pool TVL, 24h volume, and source-reported APR. No swap quote, token audit, approval, signing, or swap execution.",
    },
    {
      id: "venus-usdt-earn-market",
      name: "Venus USDT Earn Market",
      role: "Reads the BNB Chain USDT supply market and source-reported APY. No deposit, redemption, or wallet action.",
    },
    {
      id: "phoveus-execution-approval",
      name: "Execution Approval",
      role: "Requires explicit human approval before any future supported action; this hosted service currently sends no DeFi transactions.",
    },
    {
      id: "binance-agentic-wallet",
      name: "Agentic Wallet",
      role: "External supported-agent wallet path; direct hosted Phoveus execution is unverified and disabled.",
    },
  ];

  return res.status(200).json({
    ok: true,
    agent: "Phoveus",
    specialization: "Yield and tokenized-stock market-clock intelligence on BNB Chain",
    skills,
    skillPipeline: [
      "Discovery",
      "Identity",
      "Audit",
      "Research",
      "Market Clock",
      "Risk Guard",
      "Reasoning",
      "Human Approval",
      "Agentic Wallet (external and unverified)",
    ],
    executionPolicy: {
      automaticTrading: false,
      humanApprovalRequired: true,
      orderForwarded: false,
      executionLocked: true,
      guardedStates: ["REOPENING", "REFERENCE_LAG", "DATA_RESTRICTED", "NO_ASSET", "STALE_REFERENCE"],
    },
    integrations: {
      binanceWeb3Rwa: Boolean(process.env.BINANCE_WEB3_API_KEY && process.env.BINANCE_WEB3_API_SECRET),
      binanceAgentOsConfigured: Boolean(process.env.BINANCE_AGENT_OS_URL && (process.env.PHOVEUS_SESSION_SECRET || process.env.ADMIN_DEBUG_KEY)),
      defiAnalytics: {
        pancakeswapBscPools: { endpoint: "/api/pancakeswap/bsc-pools", configured: true, readOnly: true, executionLocked: true },
        venusUsdtEarn: { endpoint: "/api/venus/usdt-earn", configured: true, readOnly: true, executionLocked: true },
      },
      agenticWalletLocalPreview: {
        endpoint: null,
        configured: false,
        localOnly: true,
        previewOnly: true,
        executionLocked: true,
        note: "The local BAW bridge is not exposed by the hosted deployment.",
      },
    },
  });
}

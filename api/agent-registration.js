const card = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Phoveus",
  description:
    "Yield and DeFi analytics agent for BNB Chain. Phoveus monitors tokenized-stock market clocks and RWA divergence, compares reference yields, reads Venus USDT supply-market data, and reports indexed PancakeSwap BNB Chain pool TVL, volume, and APR. A local Termux BAW bridge can read wallet balances and prepare transaction previews only; the hosted service remains read-only and does not claim live DeFi execution. Campaign category target: yield monitoring. This card does not claim an agentId, completed hires, or on-chain execution.",
  image: "https://phoveus.vercel.app/favicon.ico",
  services: [
    {
      name: "web",
      endpoint: "https://phoveus.vercel.app/",
      version: "1.0.0",
    },
    {
      name: "A2A",
      endpoint: "https://phoveus.vercel.app/.well-known/agent-registration.json",
      version: "0.3.0",
    },
    {
      name: "venus-usdt-earn",
      endpoint: "https://phoveus.vercel.app/api/venus/usdt-earn",
      version: "1.0.0",
    },
    {
      name: "pancakeswap-bsc-pool-analytics",
      endpoint: "https://phoveus.vercel.app/api/pancakeswap/bsc-pools",
      version: "1.0.0",
    },
  ],
  registrations: [],
  active: true,
  category: "yield",
  x402Support: false,
  supportedTrust: ["reputation"],
};

export default function handler(_req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json(card);
}

export const card = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Phoveus",
  description:
    "Market-clock intelligence agent for tokenized stocks on BNB Chain. Compares on-chain token prices with reference prices, tracks market open/closed state and reference age, detects divergence, and fails closed during reopening-risk states. Read-only RWA dividend yield versus BNB flexible yield is included. Live order execution is disabled. Campaign category target: yield monitoring. Identity registration is pending; this card does not claim an agentId, completed hires, or on-chain execution.",
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
  ],
  registrations: [],
  active: true,
  category: "yield",
  x402Support: false,
  supportedTrust: ["reputation"],
};

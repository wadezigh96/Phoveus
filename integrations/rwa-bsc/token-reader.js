const DEFAULT_RPC = "https://bsc-dataseed.binance.org";
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";

function decodeUint(hex) {
  if (!/^0x[0-9a-f]+$/i.test(hex)) throw new Error("Invalid RPC result");
  return BigInt(hex).toString();
}

function decodeString(hex) {
  if (!/^0x[0-9a-f]+$/i.test(hex)) throw new Error("Invalid RPC result");
  const data = hex.slice(2);
  if (data.length < 128) throw new Error("Invalid ABI string");
  const offset = Number(BigInt("0x" + data.slice(0, 64))) * 2;
  const length = Number(BigInt("0x" + data.slice(offset, offset + 64)));
  if (!Number.isSafeInteger(length) || length < 0 || length > 4096) {
    throw new Error("Invalid ABI string length");
  }
  const bytes = data.slice(offset + 64, offset + 64 + length * 2);
  if (bytes.length !== length * 2) throw new Error("Truncated ABI string");
  return Buffer.from(bytes, "hex").toString("utf8");
}

export async function readBscRwaToken({
  rpcUrl = process.env.BSC_RPC_URL || DEFAULT_RPC,
  fetchImpl = fetch,
} = {}) {
  const request = async (method, params) => {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`BSC RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error("BSC RPC returned an error");
    return body.result;
  };

  const chainId = await request("eth_chainId", []);
  if (chainId !== "0x38") throw new Error("RPC is not BNB Smart Chain mainnet");

  const call = (data) =>
    request("eth_call", [{ to: NVDAB, data }, "latest"]);

  const [decimalsHex, symbolHex, nameHex, supplyHex] = await Promise.all([
    call("0x313ce567"),
    call("0x95d89b41"),
    call("0x06fdde03"),
    call("0x18160ddd"),
  ]);

  const decimals = Number(decodeUint(decimalsHex));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Invalid token decimals");
  }

  const totalSupplyRaw = decodeUint(supplyHex);

  return {
    ok: true,
    source: "bsc-rpc-eth-call",
    chainId: 56,
    token: {
      symbol: decodeString(symbolHex),
      name: decodeString(nameHex),
      address: NVDAB,
      decimals,
      totalSupplyRaw,
      totalSupply: (Number(totalSupplyRaw) / 10 ** decimals).toString(),
    },
    dataScope: ["name", "symbol", "decimals", "totalSupply"],
    price: null,
    dividendYieldPct: null,
    readOnly: true,
    executionLocked: true,
    orderForwarded: false,
  };
}

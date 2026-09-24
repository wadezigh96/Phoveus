# Phoveus — Binance MCP supported-agent integration

## Current finding

Phoveus previously attempted to start Binance Agent OS OAuth directly from its own web application. Binance returned error **3346001**:

> The AI Agent you are using is not currently supported.

Binance's current Agent OS documentation says that Binance MCP connects through compatible AI applications/agents. Binance also documents user-developed agents as supported in its Agent OS introduction, while its MCP launch announcement lists the currently named compatible clients as Claude Code, Claude, Codex, ChatGPT, and VS Code.

Therefore Phoveus must not claim that its public web page is itself a Binance-supported MCP client. The public web app is the intelligence, guard, evidence, and human-approval layer.

## Claude Code MVP connector

Claude Code project configuration is provided in `.mcp.json` at the repository root. It points only to Binance's official Agent OS MCP endpoint and contains no credentials. The existing `binance-mcp.json` is retained as a portable/reference configuration for other MCP clients.

Start Claude Code in the Phoveus repository and run `/mcp` to verify that `binance-mcp-server` is discovered. Authentication must be completed by Claude Code/Binance's supported-agent flow. Phoveus does not store the resulting session token.

After authentication, verify the actual server capabilities with `tools/list`. Do not infer tool names from documentation or third-party MCP implementations.

## Intended architecture

Supported agent/runtime
→ Binance MCP
→ Phoveus intelligence/approval boundary
→ execution only after explicit approval and verified tool/schema

Binance MCP endpoint:

`https://agent.binance.com/mcp/agentic`

## Safe connection test

1. Configure the Binance MCP server in a supported agent/runtime.
2. Authenticate in that agent's Binance flow.
3. Use the agent to discover the Binance MCP tools.
4. Run Phoveus RWA research and Market Clock analysis.
5. Keep Phoveus Risk Guard enabled.
6. Require explicit human approval before any state-changing action.
7. Do not paste Binance access tokens, cookies, API secrets, or private keys into Phoveus.

## What Phoveus currently verifies

- RWA source is labeled live or fallback-demo.
- Missing/restricted RWA data causes `DATA_RESTRICTED`.
- Guarded RWA decisions return `WAIT`.
- Execution remains locked when live evidence is unavailable.
- The legacy `/api/place-order` route does not guess an MCP schema.
- No order is sent merely because an execution-capable tool name is discovered.

## What is not claimed

- Direct web OAuth from Phoveus is not claimed as a working Binance MCP connection.
- No live Binance order is claimed without an independently verified MCP session and schema.
- No transaction hash, order ID, or balance is fabricated.

## Binance capability boundary

Binance currently documents MCP support for market data and trading. Account/transfer access is permission-dependent, and withdrawals are not exposed through the MCP integration. Regional and account eligibility conditions can apply.

## Judge evidence

For a demo, capture:

1. Supported agent connected to Binance MCP.
2. Binance authorization/permission screen.
3. MCP tool discovery.
4. Phoveus RWA evidence.
5. Market Clock state.
6. Risk Guard state.
7. Human approval screen.
8. Only if genuinely enabled: the resulting Binance order confirmation/ID.

Never substitute a fabricated execution result for missing live access.

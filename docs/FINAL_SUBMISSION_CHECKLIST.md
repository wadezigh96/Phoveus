# Phoveus — Final Submission Checklist

Updated: 2026-09-21

This checklist is intentionally evidence-based. A checkbox is not marked complete unless Phoveus has observable proof for it.

## Hackathon requirements

- [x] Public GitHub repository
- [x] bStocks is central to the RWA flow
- [x] Binance Web3 RWA API integration is implemented server-side with signed requests
- [x] BSC chain ID 56 is used by the RWA routes
- [x] Market/reference price intelligence
- [x] Market-clock state and reference-age handling
- [x] Reopening/reference-lag execution guard
- [x] Human approval boundary
- [x] Fail-closed behavior when RWA data is restricted/unavailable
- [x] No fabricated live prices in fallback mode
- [x] Agent capability/skill registry
- [x] Agent reasoning path limited to WAIT/REVIEW
- [x] MCP tool-discovery scaffold (`listTools()`) exists
- [x] Order endpoint is fail-closed; no MCP tool invocation or live execution is implemented
- [ ] MCP execution integration implemented and independently verified (not currently available; no execution is required for a read-only demo)
- [x] Production endpoint independently verified: `/healthz`, `/api/rwa/search?keyword=NVDA&platformId=bstock`, `/api/rwa/intelligence?symbol=NVDA&platformId=bstock`, and `/api/agent/capabilities` were manually checked on 2026-09-21; the RWA endpoints are currently in clearly labeled restricted-location fallback mode.
- [ ] Small live BSC spot transaction captured for the final demo (not yet captured; do not fabricate a transaction hash).
- [x] Agentic Wallet / Wallet Skills supported-agent runtime independently verified: `baw wallet status --json` → `CONNECTED`; BSC chain ID `56`; BSC wallet address and balance read verified; daily quota and settings read; transaction lock `UNLOCKED`; BSC gas-price read; confirmed BSC transaction history read; pending transaction query returned `transactions: []`, `hasMore: false`. Phoveus public web execution remains disabled; no new live transaction is claimed.
- [x] Developer Experience Report reviewed by the builder before submission. `docs/DEVEX_REPORT.md` is present; do not treat an unchecked review as complete.

## Truthful demo states

### LIVE
Use this label only when the response came from Binance Web3 in the current eligible environment.

### DEMO FALLBACK
Use this label when Binance Web3 is unavailable/restricted and Phoveus displays its static demonstration catalog.

Never describe fallback values as live prices.

### LOCKED
Use this state whenever execution-sensitive data is missing, restricted, stale, or in a guarded reopening/reference-lag state.

## Final judge path

1. Open the deployed Phoveus application.
2. Show the Market-Clock Intelligence panel.
3. Search/select a tokenized stock such as NVDA.
4. Run Phoveus Analysis.
5. Show the Decision Trace and Evidence Ledger.
6. Show the market state, reference age, divergence, and execution guard.
7. Show the skill/capability pipeline.
8. If a live eligible BSC execution is available, perform only the small approved spot transaction and show the transaction proof.
9. Explain the restricted-location fallback honestly if the live RWA API is unavailable in the recording environment.
10. End on the GitHub repository and deployed link.

## Current verified production state

As of 2026-09-21, the deployed backend reported `ok:true`, Binance Web3 RWA credentials configured, and Binance Agent OS not configured/connected. The RWA search and intelligence endpoints returned `source: fallback-demo` with no live price claim. This is a deployment-environment restriction state, not evidence of live RWA market data.

## Important safety boundary

Do not bypass geographic restrictions, fabricate a transaction hash, fabricate a live price, or claim that Agent OS execution is live until the actual runtime schema and resulting transaction have been verified.

## Official submission resources

- Hackathon page: https://www.bnbchain.org/en/hackathons/tokenized-stocks
- Submission form: https://forms.gle/yToDUzaDMwWnq6R6A
- Developer Experience Report template: https://forms.gle/EUQ39xf54GHjC2ys5

The official hackathon requires a public repository, demo/deployed access or reproducible judge instructions, and a Developer Experience Report. The report must reflect real development experience rather than AI-invented observations.

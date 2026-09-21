# Phoveus — Developer Experience Report

**Hackathon:** BNB Hack: Tokenized Stocks Edition  
**Project:** Phoveus — Market-Clock Intelligence Agent  
**API:** Binance Web3 API  
**Date:** 2026-09-21

> This report records the builder's actual development experience while building Phoveus. It separates observed behavior from assumptions and does not claim capabilities that were not verified.

## 1. Onboarding and first successful API call

### Time to first successful API call

Approximately **15 minutes**.

### Starting point

The first API work began from the **Binance Web3 Developer Portal**. The project was created there and the required API credentials were configured for server-side use.

### What worked

After configuring the Binance Web3 API credentials and implementing the signed request flow, Phoveus was able to reach the Binance Web3 RWA API from its backend.

The application keeps Binance credentials server-side. They are not embedded in the browser frontend.

## 2. Signing and authentication experience

The most important real integration error encountered during development was:

**`40102 — Invalid signature`**

This was the main obstacle during the initial Binance Web3 API integration.

The implementation had to be aligned with the Binance Web3 signing requirements, including the request method, request path/query string, timestamp, and HMAC-SHA256 signature construction.

The final backend signing flow constructs the pre-hash from:

`timestamp + HTTP method + request path + body`

For GET RWA requests, the signed request path includes the query string.

### Practical lesson

For a new builder, authentication is not simply an API-key header. The exact canonical request used for signing matters. A small mismatch can produce `40102 Invalid signature`.

A useful improvement would be a minimal official signed-request example that can be copied directly into a working Node.js project and tested against a simple endpoint before integrating the larger application.

## 3. RWA / tokenized-stock integration

Phoveus was designed around tokenized-stock market-clock intelligence.

The current flow uses **bStocks** as the central tokenized-stock platform and targets **BSC chain ID 56**.

The backend integrates RWA discovery and market-intelligence routes for:

- tokenized-stock search
- RWA price data
- token information
- underlying-market information
- combined market-clock intelligence

Phoveus compares the on-chain token market with the underlying/reference market and derives a guarded market state.

## 4. Restricted deployment environment

A significant real-world edge case occurred after deployment: Binance Web3 RWA requests from the deployed environment became unavailable because of a restricted-location response.

Instead of hiding the error or fabricating market values, Phoveus was changed to:

1. clearly label the response as **DEMO FALLBACK**
2. show a static tokenized-stock catalog for demonstration
3. avoid claiming a fallback value is a live price
4. fail closed for execution-sensitive decisions

This distinction is important for an agentic financial application.

The production UI therefore communicates the difference between live Binance data and demonstration metadata.

## 5. Market-clock and risk-guard design

The RWA intelligence layer was extended beyond simple price lookup.

Phoveus tracks:

- on-chain token price
- underlying/reference price
- divergence
- reference snapshot age
- market state
- next market-open information when available

Execution-sensitive states are guarded.

The current policy treats the following as guarded states:

- `REOPENING`
- `REFERENCE_LAG`
- `DATA_RESTRICTED`

When the guard is active, the agent returns **WAIT** and execution remains locked.

This was implemented deliberately so missing or restricted market information cannot silently become an execution signal.

## 6. Agent architecture and MCP integration

Phoveus uses a staged agent pipeline:

```text
Tokenized Securities Discovery
        ↓
Token Identity
        ↓
Token Audit
        ↓
RWA Research
        ↓
Market Clock
        ↓
Risk Guard
        ↓
Agent Reasoning
        ↓
Human Approval
        ↓
Agentic Wallet / Agent OS adapter
```

The repository contains an MCP adapter and a fail-closed order boundary.

The live order path does **not** guess MCP tool arguments. It first requires discovery of the actual tool and input schema. Until that schema is explicitly mapped and verified, no order is sent.

At the latest verified production state, **Binance Agent OS was not configured/connected**, so live Agent OS execution is not claimed.

## 7. Deployment and debugging experience

During development, Phoveus also encountered deployment/runtime issues.

One production failure was traced to a route syntax problem in `server.js`. The market-intelligence route had been opened as an Express route but was not closed correctly. Correcting the route closure restored the backend health endpoint.

A later frontend file cleanup was also required because duplicated HTML content had been appended after the document's closing `</html>` tag. The file was cleaned so the document ends at the actual HTML boundary.

These incidents reinforced the value of checking the deployed endpoint after every structural change instead of assuming that a successful GitHub edit means the production runtime is healthy.

## 8. API and documentation friction

The main friction points experienced during the build were:

### Authentication

The `40102 Invalid signature` error made signing correctness the first major integration challenge.

### Runtime environment differences

The RWA integration behaved differently in the deployed environment because of the restricted-location response. A local or development environment cannot automatically be assumed to have the same API availability as the deployed environment.

### Agent execution schema

For MCP execution, the application needs the actual runtime tool schema rather than an assumed `place_order` argument format. This led to a deliberate fail-closed implementation instead of guessing the schema.

## 9. Latency and reliability observations

No formal latency benchmark was collected during the build, so this report does not claim a measured latency number.

The application uses explicit fallback and fail-closed behavior around external API failures.

For the RWA intelligence layer, independent data requests are combined into a single application-level intelligence result. If execution-sensitive information is unavailable, the result remains locked instead of producing a normal execution window.

## 10. AI stack experience

Claude was integrated as an optional reasoning layer behind the backend.

The important design decision was to keep the model away from direct execution authority.

The model receives the supplied RWA intelligence and is constrained to return **WAIT** or **REVIEW**. The deterministic risk guard runs before the reasoning layer and can block the path entirely.

This creates a separation between:

- data acquisition
- deterministic safety rules
- model reasoning
- human approval
- execution adapter

The model therefore does not get to invent missing market data or independently authorize a trade.

## 11. Tokenized-stock-specific observations

The most useful product insight from the build was that tokenized-stock applications need more than a token price.

Phoveus therefore focuses on the relationship between:

- on-chain token state
- underlying/reference market state
- reference freshness
- market-open/closed state
- divergence
- execution safety

This led to the **Market-Clock Intelligence** concept.

When the reference market is unavailable, stale, reopening, or otherwise restricted, Phoveus treats that as an execution risk rather than pretending that the missing information is normal market data.

## 12. What should be improved in the API / developer experience

Based on the actual build experience, the following would materially improve onboarding:

1. **Copy-paste Node.js signing example**  
   A minimal working example for HMAC signing, including query-string handling, would reduce the time spent debugging `40102`.

2. **Authentication troubleshooting guide**  
   The documentation should show the exact canonical string used for signing and common reasons for signature mismatch.

3. **Environment/compliance visibility**  
   Developers should be able to distinguish authentication failures from regional/compliance restrictions immediately.

4. **Clear MCP tool-schema examples**  
   For Agent OS integrations, an official example showing the exact order tool name and `inputSchema` would make safe integration substantially easier.

5. **Sandbox-to-production parity**  
   A clearly documented way to test RWA endpoints in an eligible sandbox/development environment would help builders validate their integration without depending on production-region availability.

6. **Reference-market metadata**  
   Tokenized-stock developers benefit from explicit market status, reference timestamp, and freshness semantics alongside price data.

## 13. Requested capabilities

For a future version of the Binance Web3 developer experience, the most useful additions would be:

- a verified signed-request starter repository
- an authentication/signature debugger
- a safe Agent OS MCP order-schema example
- clearer RWA market-state and reference-age documentation
- a developer sandbox with representative tokenized-stock responses
- explicit compliance/availability diagnostics
- example implementations combining RWA Data, Market, Transaction, Wallet, and Agentic Wallet capabilities

## 14. Summary

The Binance Web3 integration was straightforward to prototype once the project credentials and signing flow were understood, but the **40102 Invalid signature** error was the main authentication hurdle.

The larger engineering challenge was making the application honest and safe when external conditions differed from the development assumptions. The deployed RWA environment returned a restricted-location condition, so Phoveus was designed to disclose the limitation, avoid fabricated live prices, and fail closed for execution-sensitive decisions.

The resulting architecture is intentionally layered:

**RWA data → Market Clock → Risk Guard → Agent Reasoning → Human Approval → Agent OS adapter**

The main developer-experience improvement I would request is better first-success tooling around signed requests and a clearly documented, schema-verified Agent OS execution example.

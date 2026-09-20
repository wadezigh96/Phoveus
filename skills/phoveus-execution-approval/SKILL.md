# Phoveus Execution Approval Skill

## Purpose
Create a human approval boundary between agent reasoning and an order.

## Flow
Market data -> agent reasoning -> risk guard -> approval request -> order tool.

## Rules
- The agent may prepare an order proposal.
- The server must require explicit confirmed=true.
- Guarded states cannot reach the order path.
- Never expose Binance credentials in the browser.
- Prefer a dedicated Agentic sub-account with minimum permissions.

## Principle
The agent can recommend and prepare; the user explicitly authorizes execution.

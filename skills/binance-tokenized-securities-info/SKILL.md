# Binance Tokenized Securities Info

Use Binance's official tokenized-securities data capability as the asset-discovery layer for Phoveus.

## Phoveus workflow
1. Resolve a US stock ticker to a supported tokenized-stock representation.
2. Identify the provider/platform.
3. Read market status and reference information.
4. Pass the result to Market Clock and Risk Guard.
5. Never fabricate a token contract or provider.

## Safety
This skill supplies factual market/asset data. It does not authorize execution.

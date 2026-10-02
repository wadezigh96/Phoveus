# Phoveus RWA/BNB Yield

Read-only comparison between a tokenized stock's official dividend yield and BNB flexible yield.

## Rules
- RWA yield comes from Binance Web3 `underlying-profile.dividendYield`. `"0.85"` means 0.85%.
- BNB yield comes from Binance Simple Earn flexible `latestAnnualPercentageRate` for BNB. That field is a decimal rate.
- If either source is missing, restricted, or unparsable, the spread stays empty.
- Do not invent a dividend, APR, or latest dividend.
- This utility does not approve or send an order.

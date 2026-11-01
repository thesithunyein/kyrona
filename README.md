# Kyrona

A spending desk for people who pay in USDC or NEAR.

You write down what you hold, who you pay, and the limits. Before you send, Kyrona checks the person, the asset, the per-payment cap, today’s total, and whether spending is locked. If any check fails, it tells you not to send. If they pass, you send from your own wallet and record it so the remaining budget stays true.

Kyrona does not hold keys and does not broadcast a transaction.

## Use it

1. On Desk, enter the USDC and NEAR you actually hold and save.
2. On Rules, add the accounts you pay and set the caps. Unknown accounts are refused.
3. On Pay, enter who, the asset, and the amount. Check it.
4. If it says **Do not send**, do not send. Save the stop if you want it in the ledger.
5. If it says **Safe to send**, send from your wallet, then record it. The desk balance and today’s total drop by that amount.

Lock spending from the header when you want every payment to stop.

Data stays in this browser.

## Run

```sh
npm install
npm run dev
```

## License

MIT

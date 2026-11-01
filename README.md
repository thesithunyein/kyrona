# Kyrona

Autonomous finance. Human-controlled.

Kyrona is an AI CFO desk. You set the rules. The agent writes a payment proposal. A separate gate checks the recipient, the asset, the per-payment cap, the daily budget, and the kill switch. Money moves only when every check passes.

The agent never holds a key. It can only propose.

## Problem

People can move crypto. They cannot safely hand a treasury to an autonomous agent. A full-access key is too much authority. A chat reply is not a control.

## What this preview does

Open the app and run two payments on the same path.

1. Desk loads with 420 NEAR and $1,840 USDC. The per-payment cap is $50. Ava Chen (`ava.near`) and Northline Studio are approved recipients.
2. Open **Pay** and choose **Pay Ava $150**. See **Rejected**. The transaction-limit check says $150 exceeds the $50 cap. Choose **Record the block**. No balance changes.
3. Choose **Pay Ava $40**. Every check says Pass. See **Authorized**. Choose **Settle via NEAR Intents**. USDC balance drops by 40.
4. Open **Ledger**. Both verdicts are listed: one Blocked, one Settled, each with a proposal hash. The settled row also has an intent hash.
5. Open **Rules** and turn the kill switch on (**Frozen** in the header does the same). Run **Pay Ava $40** again. See **Rejected** because spending is frozen.

Rules and the ledger stay in this browser.

## How NEAR fits

- The agent emits a structured proposal. It does not receive a full-access key.
- Policy (recipient, asset, caps, kill switch) is checked before anything can be signed. In production those rules belong in a NEAR contract, enforced by a function-call key that can only submit an already-allowed intent.
- Only an authorized proposal is a candidate for settlement through NEAR Intents.
- This preview evaluates the same checks in the browser so a judge can run the block and the settlement without gas or a mainnet key. It does not claim a live TEE or a live mainnet transfer.

## Tracks

`security`, `business`, `privacy`

## Run

```sh
npm install
npm run dev
```

The desk is the home page.

## Hackathon

Built for [NEAR Hackathon](https://nearhackathon.com/).

Independent submission. If a second project is entered from the same person, name it in this file before submitting.

## License

MIT

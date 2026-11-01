# Security

Kyrona is a spending desk. It does not custody your funds. The full-access key stays in your wallet.

## Threat model

| | |
|---|---|
| Who holds the full-access key | Your wallet. Kyrona does not ask for the 12-word phrase. The one-time deploy can be signed in the page, because Meteor blocks contract code. That key is not stored. |
| Who can move funds | A signature from that wallet, or the limited key calling `pay` inside the rules. |
| What the contract can stop | A call to `pay` that breaks the list, the lock, or a cap. |
| What it cannot stop | A transfer you start directly in Meteor. That path does not call `pay`. |

Until you put the rules on the account, the checks run in the browser. After that, `pay` runs them on the account. A failed check does not create a transfer.

## On the account

`contract/src/lib.rs` is the policy. **Put the rules on chain** creates `rules.<your account>`, deploys the code there, and copies your full-access key onto it so you still control it. Meteor blocks deploying code onto the main account. About 0.79 NEAR moves to the rules account. About 0.74 of that locks for the code. About 0.05 can be paid out. None of it is spent as a fee.

`pay` refuses a locked desk, an account that is not on the list, and an amount over either cap. It then transfers from the same account.

**Add a limited key** adds a function-call key that can call only `pay`. The allowance, 0.05 NEAR, pays gas. It cannot transfer NEAR, attach a deposit, add a key, or deploy code. The secret is stored in this browser under `kyrona-limited-key`. Anyone with that secret can call `pay` within the rules. They cannot empty the account to an address that is not on the list.

The full-access key in Meteor remains. Do not delete it. A transfer it signs directly does not pass through `pay`.

## What gets signed

- Before the contract is on the account, a NEAR payment is a single `Transfer`.
- After it is on the account, a NEAR payment calls `pay`. The contract checks the rules, then transfers.
- A USDC transfer is `ft_transfer` on the USDC contract. If the recipient has no storage deposit there, the same signature includes `storage_deposit` for that account first. USDC does not go through `pay`.
- Saving the desk is one write to `social.near` under your account, key `kyrona`. That data is public, because `social.near` is public. Do not put secrets in a memo.

## What you should assume

- A modified or malicious copy of this website could ask the wallet to sign something else. Check the address is [kyrona.vercel.app](https://kyrona.vercel.app), and read the wallet prompt before you approve it.
- The per-payment cap, the daily cap, and the lock are enforced by `pay` only after you put the rules on the account. Until then, the page checks them.
- Balances and the rules are read from a public mainnet endpoint at refresh and after a send. They can be a block behind.

## Reporting

Email [sithunyein.mailto@gmail.com](mailto:sithunyein.mailto@gmail.com). Describe what you did, what you expected, and what the wallet was asked to sign. Please give us a chance to fix a live issue before you publish it.

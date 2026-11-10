# Security

Kyrona is a spending desk. It does not custody your funds. The full-access key stays in your wallet.

## Threat model

| | |
|---|---|
| Who holds the full-access key | Your wallet. Kyrona does not ask for the 12-word phrase. The one-time deploy can be signed in the page, because Meteor blocks contract code. That key is not stored. |
| Who can move funds | A signature from that wallet, the limited key calling `pay` inside the rules, or your wallet approving a request. |
| What the contract can stop | A call to `pay` that breaks the list, the lock, or a cap. A request outside the rules moves nothing until you approve it. |
| What it cannot stop | A transfer you start directly in Meteor. That path does not call `pay`. |

Until you put the rules on the account, the checks run in the browser. After that, `pay` runs them on the account. A failed check does not create a transfer.

## On the account

`contract/src/lib.rs` is the policy. **Put the rules on chain** creates `rules.<your account>`, deploys the code there, and copies your full-access key onto it so you still control it. Meteor blocks deploying code onto the main account. About 1.31 NEAR moves to the rules account. About 1.26 of that locks for the code. About 0.05 can be paid out. None of it is spent as a fee.

`pay` refuses a locked desk, an account that is not on the list, and an amount over either cap. It then transfers from the same account. If the transfer fails, for example to an account that does not exist, the NEAR comes back and is taken off today's total.

`request` records a payment the rules do not allow, with a short note. Nothing moves. At most 20 requests wait at once. `approve` pays one and counts it toward today's total; it skips the list and the caps, but not the lock. `reject` drops one. Both need a key that names them, and the limited key does not.

The contract cannot tell your full-access key from the limited key: both sign as your account. What keeps the limited key from calling `approve`, `set_rules` or `migrate` is its method list, which NEAR checks before the contract runs. A key that names more than `pay` and `request` can do more.

`migrate` upgrades a first-version rules account in place. Only the rules account itself can call it, which in practice means your full-access key, in the same transaction that deploys the new code. (near-sdk ignores `#[private]` on init methods, so the contract checks the caller itself.)

**Add a limited key** adds a function-call key that can call only `pay` and `request`. The allowance, 0.25 NEAR, pays gas. It cannot transfer NEAR, attach a deposit, add a key, deploy code, change the rules, or approve a request. The secret is stored in this browser's local storage under `kyrona-limited-key`, so a script running on this page (a malicious copy of the site, or a browser extension that reads pages) could read it. Anyone with that secret can call `pay` within the rules and file requests, and can burn the 0.25 NEAR allowance on gas. They cannot pay an account that is not on the list, go past a cap, or approve their own requests. Delete the key from the wallet if you think it leaked.

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

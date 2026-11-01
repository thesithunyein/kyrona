# Security

Kyrona is a spending desk. It is not a custody service and it is not a smart contract.

## Threat model

| | |
|---|---|
| Who holds the keys | Your wallet. Kyrona never asks for a seed phrase or a private key. |
| Who can move funds | Only a signature from that wallet. |
| What Kyrona can stop | A payment that it itself is about to send, when a rule fails. |
| What Kyrona cannot stop | A transfer you start in Meteor, MyNearWallet, or any other app. The rules are not a restricted access key. |

The checks run in the browser, against the rules you saved and the balance read from NEAR mainnet. If every check passes, the wallet receives one transaction. If any check fails, no transaction is created.

## What gets signed

- A NEAR transfer is a single `Transfer` action to the account on your list.
- A USDC transfer is `ft_transfer` on the USDC contract. If the recipient has no storage deposit there, the same signature includes `storage_deposit` for that account first.
- Saving the desk is one write to `social.near` under your account, key `kyrona`. That data is public, because `social.near` is public. Do not put secrets in a memo.

## What you should assume

- A modified or malicious copy of this website could ask the wallet to sign something else. Check the address is [kyrona.vercel.app](https://kyrona.vercel.app), and read the wallet prompt before you approve it.
- The per-payment cap, the daily cap, and the lock are product rules. They are not enforced by the NEAR protocol.
- Balances are read from `https://rpc.mainnet.near.org` at refresh and after a send. They can be a block behind.

## Reporting

Email [sithunyein.mailto@gmail.com](mailto:sithunyein.mailto@gmail.com). Describe what you did, what you expected, and what the wallet was asked to sign. Please give us a chance to fix a live issue before you publish it.

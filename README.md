# Kyrona

Spending limits before you send NEAR or USDC.

Live: https://kyrona.vercel.app

Connect a NEAR wallet. Kyrona reads that account’s balance from the chain. You name who you pay and set a per-payment cap, a daily cap, and a lock. Before anything is signed, Kyrona checks the person, the asset, both caps, the lock, and the balance. A failed check does not open a transfer. A passed check asks your wallet to sign. The transaction hash is the record.

Kyrona does not hold keys. Your wallet signs and broadcasts.

## Use it

Chrome, with the [Meteor](https://meteorwallet.app) extension.

1. Open the site and choose **Connect**, then Meteor.
2. On Desk, choose **Refresh**. The figures are the chain balance, not a number you type. Meteor may hide about 0.2 NEAR as a gas reserve. The desk shows the full balance.
3. On Rules, add each account you pay. An account that is not on the list cannot be paid. Set the caps. **Locked** in the header stops every payment. **Open** means spending is allowed.
4. On Pay, choose the person, NEAR or USDC, and the amount. Choose **Check against my rules**.
5. **Do not send** means a check failed. Nothing is signed. **Save this stop** writes that refusal in the ledger.
6. **Safe to send** means every check passed. **Send on NEAR** opens the wallet. After you sign, the ledger stores the hash and the desk balance updates from the chain.

To prove a stop, check a NEAR payment larger than the per-payment cap. To prove a send, pay 0.01 NEAR to an account on your list. Sending to your own account is enough.

**Save to my account** on Rules writes the limits and the ledger to `social.near`, signed by you, so the same wallet can load them in another browser. Until you do that, they stay on this phone or computer.

## What this is not

- The limits are enforced by Kyrona before it asks for a signature. A transfer made directly in Meteor is not checked.
- There is no cross-chain swap and no private computation.
- USDC can be sent only when the account actually holds USDC.

## Run

```sh
npm install
npm run dev
```

The dev server is http://127.0.0.1:8080

## License

MIT

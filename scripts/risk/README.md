# Receiver check

`check.mjs` decides, before the agent signs, whether a receiver is allowed, needs a person, or is blocked.

| Signal | How it is read | Verdict |
|---|---|---|
| The account does not exist | NEAR RPC `view_account` | block (an implicit account that does not exist yet: warn) |
| It is on the shared blocklist | `blocklist.json`, or the file in `KYRONA_BLOCKLIST` | block |
| It is a contract whose code changed since it was pinned | NEAR RPC code hash against `.kyrona-pins.json` | block |
| It is a contract never paid before | NEAR RPC code hash, no pin | warn |
| It was created less than 7 days ago | NearBlocks `/v1/account/<id>`, `created.block_timestamp` | warn |

The contract still applies its own rules after an allow: the list, the caps and the lock.

## The blocklist

`blocklist.json` is shared through this repository: anyone can propose an entry in a pull request. Every entry needs evidence a reader can check, such as a transaction or a public report. It ships empty; no account is listed without evidence.

```json
[{ "account": "example.near", "reason": "what it did", "evidence": "https://nearblocks.io/txns/..." }]
```

## Pins

`npm run check-receiver -- <account> --pin` records a contract's current code hash in `.kyrona-pins.json` (ignored by git). After that, the same code is allowed and changed code is blocked. The AI agent pins a contract the first time a payment to it is approved and goes through.

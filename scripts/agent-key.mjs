// Gives the agent its own key: a function-call key on the owner's account that may call only
// `pay` and `request` on the rules account. NEAR enforces that limit.
//
//   KYRONA_OWNER_KEY='ed25519:...' node scripts/agent-key.mjs          # dry run
//   KYRONA_OWNER_KEY='ed25519:...' node scripts/agent-key.mjs --send   # adds the key
//
// The new secret is written to .kyrona-key (ignored by git), where scripts/agent.mjs and
// scripts/llm-agent.mjs read it. It is never printed. Delete the key from the wallet to revoke it.
// Optional: KYRONA_OWNER (default sithunyein.near), KYRONA_RPC, KYRONA_KEY_FILE (default .kyrona-key).

import { existsSync, writeFileSync } from "node:fs";
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

const OWNER = process.env.KYRONA_OWNER?.trim() || "sithunyein.near";
const RULES = `rules.${OWNER}`;
const RPC = process.env.KYRONA_RPC?.trim() || "https://free.rpc.fastnear.com";
const SEND = process.argv.includes("--send");
const txLink = (hash) => (/127\.0\.0\.1|localhost/.test(RPC) ? `transaction ${hash} on the local node` : `https://nearblocks.io/txns/${hash}`);
const ALLOWANCE = 250_000_000_000_000_000_000_000n; // 0.25 NEAR of gas, the same as the desk's key
const KEY_FILE = process.env.KYRONA_KEY_FILE?.trim() || new URL("../.kyrona-key", import.meta.url);
const KEY_NAME = process.env.KYRONA_KEY_FILE?.trim() ? "the file in KYRONA_KEY_FILE" : ".kyrona-key";

function stop(message) {
  console.error(message);
  process.exit(1);
}

const secret = process.env.KYRONA_OWNER_KEY?.trim();
if (!secret?.startsWith("ed25519:")) stop("Put the owner's full-access key in KYRONA_OWNER_KEY. It starts with ed25519:");
const signer = KeyPairSigner.fromSecretKey(secret);
const provider = new JsonRpcProvider({ url: RPC });
const ownerKey = (await signer.getPublicKey()).toString();
const access = await provider.viewAccessKey(OWNER, ownerKey, { finality: "final" }).catch(() => null);
if (!access || access.permission !== "FullAccess") stop(`This key is not a full-access key on ${OWNER}. Nothing was sent.`);
const rules = await provider.callFunction(RULES, "requests", {}).catch(() => null);
if (!Array.isArray(rules)) stop(`${RULES} does not run the second version (no requests). Run scripts/upgrade.mjs first.`);

console.log(`Owner        ${OWNER}`);
console.log(`New key      may call pay and request on ${RULES}, nothing else; 0.25 NEAR of gas`);
console.log(`Secret       written to ${KEY_NAME}${existsSync(KEY_FILE) ? " (replacing the file that is there)" : ""}`);
console.log("");
if (!SEND) {
  console.log("Dry run. Nothing was sent. Run again with --send to add the key.");
  process.exit(0);
}

const pair = KeyPair.fromRandom("ed25519");
const owner = new Account(OWNER, provider, signer);
const added = await owner.signAndSendTransaction({
  receiverId: OWNER,
  actions: [actionCreators.addKey(pair.getPublicKey(), actionCreators.functionCallAccessKey(RULES, ["pay", "request"], ALLOWANCE))],
  throwOnFailure: true,
});
writeFileSync(KEY_FILE, `${pair.toString()}\n`, { mode: 0o600 });
console.log(`Added ${pair.getPublicKey().toString()}`);
console.log(`${txLink(added.transaction.hash)}`);
console.log(`The secret is in ${KEY_NAME}. Do not commit or share it.`);

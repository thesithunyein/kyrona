// Upgrades rules.<owner> from the first version of the contract to public/kyrona.wasm, in place.
//
//   KYRONA_OWNER_KEY='ed25519:...' node scripts/upgrade.mjs          # dry run: shows the plan, sends nothing
//   KYRONA_OWNER_KEY='ed25519:...' node scripts/upgrade.mjs --send   # tops up storage if needed, then upgrades
//
// The key must be the owner's full-access key, the one the desk also put on the rules account.
// It is read from the environment and never written anywhere. Do not commit it.
// Optional: KYRONA_OWNER (default sithunyein.near), KYRONA_RPC (default a public mainnet RPC).
//
// The upgrade is one transaction signed by the rules account: deploy the new code and call
// `migrate`, which keeps the owner, the list, the caps, the lock and today's spend. The script
// refuses unless the account runs exactly contract/v1/kyrona-v1.wasm.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

const OWNER = process.env.KYRONA_OWNER?.trim() || "sithunyein.near";
const RULES = `rules.${OWNER}`;
const RPC = process.env.KYRONA_RPC?.trim() || "https://free.rpc.fastnear.com";
const SEND = process.argv.includes("--send");
const YOCTO_PER_BYTE = 10n ** 19n; // NEAR storage staking: 1 NEAR per 100 kB
const NEAR = 10n ** 24n;
const SPARE = NEAR / 50n; // 0.02 NEAR left over for payouts and future state
const TGAS = 10n ** 12n;
const MIGRATE_GAS = 20n * TGAS; // migrate reads and rewrites a few hundred bytes
const DEPLOY_GAS = 20n * TGAS; // the deploy action itself, for about 126 kB, rounded up
// Before NEAR checks that an account can pay for its storage, it holds back the gas the
// transaction may still burn, priced pessimistically (about 10 times the gas price on mainnet).
// The upgrade budgets 15 times, so the storage check cannot fall short.
const GAS_PRICE_MULTIPLE = 15n;

const v1 = readFileSync(new URL("../contract/v1/kyrona-v1.wasm", import.meta.url));
const v2 = readFileSync(new URL("../public/kyrona.wasm", import.meta.url));

function codeHash(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${createHash("sha256").update(bytes).digest("hex")}`);
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

const near = (yocto) => {
  const whole = yocto / NEAR;
  const frac = ((yocto % NEAR) * 10000n) / NEAR;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
};

function stop(message) {
  console.error(message);
  process.exit(1);
}

const secret = process.env.KYRONA_OWNER_KEY?.trim();
if (!secret?.startsWith("ed25519:")) stop("Put the owner's full-access key in KYRONA_OWNER_KEY. It starts with ed25519:");
const signer = KeyPairSigner.fromSecretKey(secret);
const provider = new JsonRpcProvider({ url: RPC });
const publicKey = (await signer.getPublicKey()).toString();

for (const accountId of [OWNER, RULES]) {
  // Checked at a final block, the same view the transaction is built from.
  const key = await provider.viewAccessKey(accountId, publicKey, { finality: "final" }).catch(() => null);
  if (!key || key.permission !== "FullAccess") stop(`This key is not a full-access key on ${accountId}. Nothing was sent.`);
}

const account = await provider.viewAccount(RULES);
const v1Hash = codeHash(v1);
const v2Hash = codeHash(v2);
if (account.code_hash === v2Hash) {
  console.log(`${RULES} already runs this build (${v2Hash}). Nothing to do.`);
  process.exit(0);
}
if (account.code_hash !== v1Hash) {
  stop(`${RULES} runs code ${account.code_hash}, not the first version (${v1Hash}). Nothing was sent.`);
}

const before = await provider.callFunction(RULES, "rules", {});
const oldCode = (await provider.viewContractCode(RULES)).code.length;
const usageAfter = BigInt(account.storage_usage) - BigInt(oldCode) + BigInt(v2.length);
const gasPrice = BigInt((await provider.gasPrice(null)).gas_price);
const gasHeld = (MIGRATE_GAS + DEPLOY_GAS) * gasPrice * GAS_PRICE_MULTIPLE;
const needed = usageAfter * YOCTO_PER_BYTE + SPARE + gasHeld;
const topUp = account.amount >= needed ? 0n : needed - account.amount;

// The owner pays the top-up and a transaction fee, and must keep enough for its own storage.
const ownerAccount = await provider.viewAccount(OWNER);
const ownerKeeps = BigInt(ownerAccount.storage_usage) * YOCTO_PER_BYTE;
const FEE = NEAR / 100n; // 0.01 NEAR, well above what a transfer costs
const ownerNeeds = topUp === 0n ? 0n : topUp + FEE + ownerKeeps;
const ownerShort = ownerNeeds > ownerAccount.amount ? ownerNeeds - ownerAccount.amount : 0n;

console.log(`Rules account   ${RULES}`);
console.log(`Now             first version ${v1Hash}, ${oldCode} bytes`);
console.log(`After           ${v2Hash}, ${v2.length} bytes`);
console.log(`Balance         ${near(account.amount)} NEAR; storage after the upgrade needs ${near(usageAfter * YOCTO_PER_BYTE)} NEAR, plus ${near(gasHeld)} held for gas and 0.02 spare`);
console.log(`Top-up          ${topUp > 0n ? `${near(topUp)} NEAR from ${OWNER} to ${RULES}` : "none needed"}`);
if (topUp > 0n) {
  console.log(`Owner balance   ${near(ownerAccount.amount)} NEAR on ${OWNER}; the top-up, a fee and its own storage need ${near(ownerNeeds)} NEAR`);
}
console.log(`Rules kept      ${before.allowed.length} accounts, ${near(BigInt(before.max_per_payment))} NEAR per payment, ${near(BigInt(before.daily_cap))} NEAR a day, ${before.open ? "open" : "locked"}`);
console.log("");

if (ownerShort > 0n) {
  console.log(`Add at least ${near(ownerShort)} NEAR to ${OWNER}, then run this again. Nothing was sent.`);
  process.exit(SEND ? 1 : 0);
}

if (!SEND) {
  console.log("Dry run. Nothing was sent. Run again with --send to upgrade.");
  process.exit(0);
}

if (topUp > 0n) {
  const owner = new Account(OWNER, provider, signer);
  const funded = await owner.signAndSendTransaction({
    receiverId: RULES,
    actions: [actionCreators.transfer(topUp)],
    throwOnFailure: true,
  });
  console.log(`Topped up ${near(topUp)} NEAR: https://nearblocks.io/txns/${funded.transaction.hash}`);
}

const rules = new Account(RULES, provider, signer);
const upgraded = await rules.signAndSendTransaction({
  receiverId: RULES,
  actions: [actionCreators.deployContract(new Uint8Array(v2)), actionCreators.functionCall("migrate", {}, MIGRATE_GAS, 0n)],
  throwOnFailure: true,
});
console.log(`Upgraded: https://nearblocks.io/txns/${upgraded.transaction.hash}`);

// Reads use final blocks, which trail the transaction by a moment.
let code = "";
for (let tries = 0; tries < 30; tries += 1) {
  code = (await provider.viewAccount(RULES)).code_hash;
  if (code === v2Hash) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const after = await provider.callFunction(RULES, "rules", {});
const kept = ["owner", "max_per_payment", "daily_cap", "open"].every((field) => after[field] === before[field]) &&
  JSON.stringify(after.allowed) === JSON.stringify(before.allowed);
console.log(`Code now        ${code}${code === v2Hash ? "" : " (not the expected build!)"}`);
console.log(`Rules           ${kept ? "kept as they were" : "CHANGED, check them on the desk"}`);
console.log(`Requests        ${(await provider.callFunction(RULES, "requests", {})).length} waiting`);
if (!kept || code !== v2Hash) process.exit(1);
console.log("");
console.log("Done. Add a new limited key on the desk: keys added before the upgrade can call pay but not request.");

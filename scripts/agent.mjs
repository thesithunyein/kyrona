import { readFileSync } from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

// Set these to run the agent against your own rules account.
const ACCOUNT = process.env.KYRONA_ACCOUNT?.trim() || "sithunyein.near";
const RULES = process.env.KYRONA_RULES?.trim() || `rules.${ACCOUNT}`;
const PAYEE = process.env.KYRONA_PAYEE?.trim() || "kyawminthat.near";
const OUTSIDE = process.env.KYRONA_OUTSIDE?.trim() || "outside.near";
const RPC = process.env.KYRONA_RPC?.trim() || "https://free.rpc.fastnear.com";
const GAS = 30_000_000_000_000n;
const ALLOWED_METHODS = ["pay", "request"];

const secret = loadSecret();
const signer = KeyPairSigner.fromSecretKey(secret);
const provider = new JsonRpcProvider({ url: RPC });
const account = new Account(ACCOUNT, provider, signer);
const publicKey = (await signer.getPublicKey()).toString();

const accessKey = await provider.viewAccessKey(ACCOUNT, publicKey);
const permission = accessKey.permission;
if (permission === "FullAccess" || permission?.FullAccess !== undefined && !permission.FunctionCall) {
  console.error("This key can do more than pay. The agent will not use it.");
  process.exit(1);
}
const call = permission.FunctionCall;
if (
  !call ||
  call.receiver_id !== RULES ||
  !call.method_names?.length ||
  call.method_names.some((name) => !ALLOWED_METHODS.includes(name))
) {
  console.error("This key is not limited to pay and request on the rules account. The agent will not use it.");
  process.exit(1);
}
const canRequest = call.method_names.includes("request");

console.log(`Key ${publicKey}`);
console.log(`This key can call ${call.method_names.join(" and ")} on ${RULES}, and nothing else.`);

const refused = await attempt(RULES, [actionCreators.functionCall("pay", { to: OUTSIDE, amount: "1" }, GAS, 0n)]);
if (!refused.toLowerCase().includes("not on the list")) {
  console.error(refused || "The unknown account was not refused.");
  process.exit(1);
}
console.log(`Refused. ${OUTSIDE} is not on the list.`);

const transfer = await attempt(ACCOUNT, [actionCreators.transfer(1n)]);
if (!transfer) {
  console.error("The limited key transferred NEAR. That should not happen.");
  process.exit(1);
}
console.log("Refused. This key cannot transfer.");

const paid = await account.signAndSendTransaction({
  receiverId: RULES,
  actions: [actionCreators.functionCall("pay", { to: PAYEE, amount: "10000000000000000000000" }, GAS, 0n)],
  throwOnFailure: true,
});
const hash = paid.transaction.hash;
console.log(`Paid 0.01 NEAR to ${PAYEE}`);
console.log(`https://nearblocks.io/txns/${hash}`);

if (canRequest) {
  const asked = await account.signAndSendTransaction({
    receiverId: RULES,
    actions: [
      actionCreators.functionCall(
        "request",
        { to: OUTSIDE, amount: "10000000000000000000000", note: "A new vendor, not on the list" },
        GAS,
        0n,
      ),
    ],
    throwOnFailure: true,
  });
  console.log(`Asked the owner for 0.01 NEAR to ${OUTSIDE}. Nothing moved; it waits on the desk.`);
  console.log(`https://nearblocks.io/txns/${asked.transaction.hash}`);
}

function loadSecret() {
  const fromEnv = process.env.KYRONA_LIMITED_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(new URL("../.kyrona-key", import.meta.url), "utf8").trim();
  } catch {
    console.error("No limited key. Put it in KYRONA_LIMITED_KEY or .kyrona-key. Do not commit it.");
    process.exit(1);
  }
}

async function attempt(receiverId, actions) {
  try {
    await account.signAndSendTransaction({ receiverId, actions, throwOnFailure: true });
    return "";
  } catch (error) {
    return text(error);
  }
}

function text(error) {
  const parts = [];
  let current = error;
  for (let i = 0; i < 5 && current; i += 1) {
    if (typeof current === "string") parts.push(current);
    else if (current.message) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

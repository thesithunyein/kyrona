import { readFileSync } from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

const ACCOUNT = "sithunyein.near";
const RULES = "rules.sithunyein.near";
const PAYEE = "kyawminthat.near";
const RPC = "https://free.rpc.fastnear.com";
const GAS = 15_000_000_000_000n;

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
if (!call || call.receiver_id !== RULES || !call.method_names?.length || call.method_names.some((name) => name !== "pay")) {
  console.error("This key is not limited to pay on the rules account. The agent will not use it.");
  process.exit(1);
}

console.log(`Key ${publicKey}`);
console.log("This key can call pay, and nothing else.");

const refused = await attempt(RULES, [actionCreators.functionCall("pay", { to: "outside.near", amount: "1" }, GAS, 0n)]);
if (!refused.toLowerCase().includes("not on the list")) {
  console.error(refused || "The unknown account was not refused.");
  process.exit(1);
}
console.log("Refused. outside.near is not on the list.");

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

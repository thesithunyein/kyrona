// Kyrona judge run: the rules contract on a local NEAR sandbox, attacked with the agent's key.
//
// No wallet, no keys, no funds. near-workspaces downloads a local NEAR node on the first run,
// deploys public/kyrona.wasm (the same file the live desk deploys), and gives an "agent" a
// function-call key that may only call `pay` on the rules account. Then the agent tries to
// pay, overpay, pay strangers, and get around the contract. Every line below is checked:
// the run exits 1 if any outcome differs from what is printed as expected.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Worker, KeyPairEd25519 } from "near-workspaces";
import { transactions } from "near-api-js";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const near = (n) => (BigInt(Math.round(n * 1000)) * NEAR) / 1000n;
const fmt = (yocto) => (Number((BigInt(yocto) * 1000n) / NEAR) / 1000).toString();

const PER_PAYMENT = near(2);
const DAILY_CAP = near(3);
const KEY_ALLOWANCE = near(0.25);

const lines = [];
let failures = 0;
const say = (text = "") => {
  lines.push(text);
  console.log(text);
};

function reason(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const known = [
    "Not on the list",
    "Over the per-payment cap",
    "Over the daily cap",
    "Spending is locked",
    "Only the owner",
    "Amount is empty",
  ].find((message) => text.includes(message));
  if (known) return known;
  const match = text.match(/"type":"([A-Za-z]+)"|([A-Z][A-Za-z]+(?:Mismatch|Error|Denied|Access[A-Za-z]*))/);
  return (match && (match[1] || match[2])) || text.slice(0, 220);
}

// Runs one attempt and reports how it ended: "paid", "contract" (the rules said no) or
// "protocol" (NEAR refused the transaction because the key may not do that).
async function attempt(run) {
  try {
    const result = await run();
    if (result.failed) {
      return { outcome: "contract", why: reason(result.Failure ?? result.receiptFailureMessages) };
    }
    if (result.receiptFailureMessages.length > 0) {
      return { outcome: "contract", why: reason(result.receiptFailureMessages.join(" ")) };
    }
    return { outcome: "paid", why: "" };
  } catch (error) {
    // near-api-js puts NEAR's error kind in `type` (RequiresFullAccess, MethodNameMismatch, ...);
    // its English message for some kinds is misleading, so report the kind first.
    const kind = typeof error?.type === "string" ? error.type : "";
    const message =
      kind === "RequiresFullAccess"
        ? "a function-call key can only call the methods it names; this needs a full-access key"
        : reason(error?.message ?? String(error));
    return { outcome: "protocol", why: kind ? `${kind} (${message})` : message };
  }
}

function check(label, got, expected) {
  const keyRefusal =
    expected.outcome === "protocol" &&
    got.outcome === "contract" &&
    /access|mismatch|fullaccess|notallowed|permission/i.test(got.why);
  if (keyRefusal) got = { outcome: "protocol", why: got.why };
  const ok = got.outcome === expected.outcome && (!expected.why || got.why.includes(expected.why));
  if (!ok) failures += 1;
  const said =
    got.outcome === "paid" ? "PAID" : got.outcome === "contract" ? `REFUSED by the contract: ${got.why}` : `REFUSED by NEAR: ${got.why}`;
  say(`${ok ? "ok  " : "FAIL"}  ${label}\n      -> ${said}${ok ? "" : `   (expected ${expected.outcome}${expected.why ? `: ${expected.why}` : ""})`}`);
}

// near-workspaces 5.0.0 downloads nearcore 2.0.0 by default, which cannot load a contract built
// for current mainnet. Pin the sandbox to the version near-sandbox-js ships (2.14.0). It runs on
// Linux x86_64 and Apple Silicon macOS; on Windows, use WSL.
const SANDBOX_VERSION = "2.14.0";
const platform = process.platform === "linux" && process.arch === "x64" ? "Linux-x86_64"
  : process.platform === "darwin" && process.arch === "arm64" ? "Darwin-arm64"
  : null;
if (!platform) {
  console.error(`The NEAR sandbox runs on Linux x86_64 and Apple Silicon macOS, not ${process.platform} ${process.arch}. On Windows, run this inside WSL.`);
  process.exit(1);
}
process.env.SANDBOX_ARTIFACT_URL ??=
  `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform}/${SANDBOX_VERSION}/near-sandbox.tar.gz`;

// `npm install` already fetched near-sandbox's default binary, and an existing binary is reused
// as is. If it is not the pinned version, remove it so near-workspaces downloads the pinned one.
const sandboxBin = join(dirname(createRequire(import.meta.url).resolve("near-sandbox/package.json")), "bin", "near-sandbox");
if (existsSync(sandboxBin)) {
  let installed = "";
  try {
    installed = execFileSync(sandboxBin, ["--version"], { encoding: "utf8" });
  } catch {
    installed = "";
  }
  if (!installed.includes(SANDBOX_VERSION)) rmSync(sandboxBin, { force: true });
}

const worker = await Worker.init();
try {
  const running = (await worker.provider.status()).version.version;
  if (!running.startsWith(SANDBOX_VERSION)) {
    throw new Error(
      `The sandbox is nearcore ${running}, not ${SANDBOX_VERSION}. Delete judge/node_modules/near-sandbox/bin and run again.`,
    );
  }
  const root = worker.rootAccount;
  const owner = await root.createSubAccount("owner", { initialBalance: near(30) });
  const alice = await root.createSubAccount("alice", { initialBalance: near(1) });
  const mallory = await root.createSubAccount("mallory", { initialBalance: near(1) });
  const rulesId = `rules.${owner.accountId}`;

  say("Kyrona judge run, local NEAR sandbox");
  say("");
  say(`Owner        ${owner.accountId} (full-access key, sets the rules)`);
  say(`Rules        ${rulesId} (public/kyrona.wasm)`);
  say(`Allowlist    ${alice.accountId}`);
  say(`Stranger     ${mallory.accountId} (not on the list)`);
  say(`Caps         ${fmt(PER_PAYMENT)} NEAR per payment, ${fmt(DAILY_CAP)} NEAR a day`);
  say("");

  // The same single transaction the desk sends: create the rules account, keep the owner's
  // key on it, deploy the contract, and call `new`, so the owner is the predecessor.
  const ownerKey = await owner.getKey();
  const wasm = readFileSync(new URL("../public/kyrona.wasm", import.meta.url));
  const deployed = await owner
    .batch(rulesId)
    .createAccount()
    .transfer(near(10))
    .addKey(ownerKey.getPublicKey())
    .deployContract(wasm)
    .functionCall(
      "new",
      { max_per_payment: PER_PAYMENT.toString(), daily_cap: DAILY_CAP.toString(), open: true, allowed: [alice.accountId] },
      { gas: 100n * TGAS },
    )
    .transact();
  if (deployed.failed) throw new Error(`Deploy failed: ${JSON.stringify(deployed.Failure)}`);
  const rules = owner.getAccount(rulesId);

  // The agent's key: a function-call key on the owner's account that can call `pay` on the
  // rules account and nothing else. NEAR enforces that limit, not this script.
  const agentKey = KeyPairEd25519.fromRandom();
  const added = await owner
    .batch(owner)
    .addKey(agentKey.getPublicKey(), transactions.functionCallAccessKey(rulesId, ["pay"], KEY_ALLOWANCE))
    .transact();
  if (added.failed) throw new Error(`Adding the agent key failed: ${JSON.stringify(added.Failure)}`);
  say(`Agent key    ${agentKey.getPublicKey().toString()}`);
  say(`             may call only pay on ${rulesId}`);
  say("");

  const agentPays = (to, amount) =>
    attempt(() =>
      owner.callRaw(rulesId, "pay", { to, amount: amount.toString() }, { signWithKey: agentKey, gas: 30n * TGAS }),
    );
  const aliceBefore = BigInt((await alice.accountView()).amount);
  const malloryBefore = BigInt((await mallory.accountView()).amount);

  say("1. The agent pays inside the rules");
  check(`pay 1 NEAR to ${alice.accountId}`, await agentPays(alice.accountId, near(1)), { outcome: "paid" });
  say("");

  say("2. A prompt-injected invoice tells the agent to pay someone else");
  check(
    `pay 0.5 NEAR to ${mallory.accountId}`,
    await agentPays(mallory.accountId, near(0.5)),
    { outcome: "contract", why: "Not on the list" },
  );
  say("");

  say("3. Too much in one payment");
  check(
    `pay 2.5 NEAR to ${alice.accountId}`,
    await agentPays(alice.accountId, near(2.5)),
    { outcome: "contract", why: "Over the per-payment cap" },
  );
  say("");

  say("4. Too much in one day (1 NEAR already spent today)");
  check(`pay 1.5 NEAR to ${alice.accountId}`, await agentPays(alice.accountId, near(1.5)), { outcome: "paid" });
  check(
    `pay 1 NEAR to ${alice.accountId} (would make 3.5 today)`,
    await agentPays(alice.accountId, near(1)),
    { outcome: "contract", why: "Over the daily cap" },
  );
  say("");

  say("5. The agent tries to get around the contract with its own key");
  check(
    `transfer 0.01 NEAR straight to ${mallory.accountId}`,
    await attempt(() => owner.batch(mallory).transfer(near(0.01)).transact(agentKey)),
    { outcome: "protocol", why: "RequiresFullAccess" },
  );
  check(
    `call set_rules to put ${mallory.accountId} on the list`,
    await attempt(() =>
      owner.callRaw(
        rulesId,
        "set_rules",
        { max_per_payment: near(100).toString(), daily_cap: near(100).toString(), open: true, allowed: [mallory.accountId] },
        { signWithKey: agentKey, gas: 30n * TGAS },
      ),
    ),
    { outcome: "protocol", why: "MethodNameMismatch" },
  );
  check(
    "add a full-access key for itself",
    await attempt(() => owner.batch(owner).addKey(KeyPairEd25519.fromRandom().getPublicKey()).transact(agentKey)),
    { outcome: "protocol", why: "RequiresFullAccess" },
  );
  say("");

  say("6. The owner locks spending");
  const locked = await owner.callRaw(rulesId, "set_rules", {
    max_per_payment: PER_PAYMENT.toString(),
    daily_cap: DAILY_CAP.toString(),
    open: false,
    allowed: [alice.accountId],
  });
  if (locked.failed) throw new Error(`Locking failed: ${JSON.stringify(locked.Failure)}`);
  check(
    `pay 0.1 NEAR to ${alice.accountId} while locked`,
    await agentPays(alice.accountId, near(0.1)),
    { outcome: "contract", why: "Spending is locked" },
  );
  say("");

  const view = await rules.view("rules");
  const aliceGot = BigInt((await alice.accountView()).amount) - aliceBefore;
  const malloryGot = BigInt((await mallory.accountView()).amount) - malloryBefore;
  say("What moved");
  say(`  ${alice.accountId} received ${fmt(aliceGot)} NEAR (expected 2.5)`);
  say(`  ${mallory.accountId} received ${fmt(malloryGot)} NEAR (expected 0)`);
  say(`  the contract records ${fmt(view.spent)} NEAR spent today`);
  if (aliceGot !== near(2.5)) failures += 1;
  if (malloryGot !== 0n) failures += 1;
  if (BigInt(view.spent) !== near(2.5)) failures += 1;
  say("");

  say(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
} catch (error) {
  failures += 1;
  say(`The run stopped: ${error?.stack ?? error}`);
} finally {
  await worker.tearDown().catch(() => {});
  if (process.env.GITHUB_ACTIONS) {
    const body = lines.join("\n").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::notice title=Kyrona judge run::${body}`);
  }
}
process.exit(failures === 0 ? 0 : 1);

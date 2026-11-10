// Kyrona judge run: the rules contract on a local NEAR sandbox, attacked with the agent's key.
//
// No wallet, no keys, no funds. near-workspaces downloads a local NEAR node on the first run.
// The run deploys contract/v1/kyrona-v1.wasm (the exact code on rules.sithunyein.near), upgrades
// it to public/kyrona.wasm with `migrate` the way the mainnet account is upgraded, and gives an
// "agent" a function-call key that may only call `pay` and `request`. Then the agent tries to
// pay, overpay, pay strangers, approve itself, and get around the contract. Every line below is
// checked: the run exits 1 if any outcome differs from what is printed as expected.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, KeyPair, KeyPairEd25519 } from "near-workspaces";
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
    "No such request",
    "Too many requests waiting",
    "is private",
    "Only the rules account can migrate",
  ].find((message) => text.includes(message));
  if (known) return known;
  const panic = text.match(/"ExecutionError":"([^"]+)"/) || text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1].slice(0, 220);
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

function check(label, got, expected, done = "PAID") {
  const keyRefusal =
    expected.outcome === "protocol" &&
    got.outcome === "contract" &&
    /access|mismatch|fullaccess|notallowed|permission/i.test(got.why);
  if (keyRefusal) got = { outcome: "protocol", why: got.why };
  const ok = got.outcome === expected.outcome && (!expected.why || got.why.includes(expected.why));
  if (!ok) failures += 1;
  const said =
    got.outcome === "paid" ? done : got.outcome === "contract" ? `REFUSED by the contract: ${got.why}` : `REFUSED by NEAR: ${got.why}`;
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


const V1_WASM = new URL("../contract/v1/kyrona-v1.wasm", import.meta.url);
const V2_WASM = new URL("../public/kyrona.wasm", import.meta.url);

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
  const ghost = `ghost.${root.accountId}`; // on the list, but the account does not exist
  const rulesId = `rules.${owner.accountId}`;
  const rulesArgs = (open, allowed) => ({
    max_per_payment: PER_PAYMENT.toString(),
    daily_cap: DAILY_CAP.toString(),
    open,
    allowed,
  });

  say(`Kyrona judge run, local NEAR sandbox (nearcore ${running})`);
  say("");
  say(`Owner        ${owner.accountId} (full-access key, sets the rules, approves requests)`);
  say(`Rules        ${rulesId}`);
  say(`Allowlist    ${alice.accountId}`);
  say(`Stranger     ${mallory.accountId} (not on the list)`);
  say(`Caps         ${fmt(PER_PAYMENT)} NEAR per payment, ${fmt(DAILY_CAP)} NEAR a day`);
  say("");

  // The same single transaction the desk sends: create the rules account, keep the owner's key
  // on it, deploy the first version, and call `new`, so the owner is the predecessor.
  const ownerKey = await owner.getKey();
  const deployed = await owner
    .batch(rulesId)
    .createAccount()
    .transfer(near(0.95)) // about what rules.sithunyein.near held, so the upgrade must top it up
    .addKey(ownerKey.getPublicKey())
    .deployContract(readFileSync(V1_WASM))
    .functionCall("new", rulesArgs(true, [alice.accountId]), { gas: 100n * TGAS })
    .transact();
  if (deployed.failed) throw new Error(`Deploy failed: ${JSON.stringify(deployed.Failure)}`);
  const rules = owner.getAccount(rulesId);
  await rules.setKey(ownerKey); // the owner's key is also a full-access key on the rules account

  // scripts/upgrade.mjs and scripts/agent.mjs are the programs that run on mainnet. When the
  // app's packages are installed (`npm install` at the root, as CI does), the judge runs them
  // against this sandbox; otherwise it does the same steps itself.
  const scriptsReady = existsSync(new URL("../node_modules/@near-js/accounts/package.json", import.meta.url));
  const rpcUrl = worker.provider.connection.url;
  const runScript = (name, args, env, okCodes = [0]) => {
    try {
      return execFileSync(process.execPath, [fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), ...args], {
        env: { ...process.env, KYRONA_RPC: rpcUrl, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (okCodes.includes(error.status)) return error.stdout ?? "";
      throw new Error(`scripts/${name} failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
    }
  };
  // check-receiver.mjs reads final blocks; wait for a just-deployed contract to be final.
  const untilFinalCode = async (accountId, codeHash) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const seen = await worker.provider
        .query({ request_type: "view_account", account_id: accountId, finality: "final" })
        .then((a) => a.code_hash, () => null);
      if (seen === codeHash) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`The code on ${accountId} did not become final.`);
  };
  // The scripts build transactions from final blocks, which trail a freshly started sandbox.
  // Wait until a key just added is final before handing it to them.
  const untilFinal = async (accountId, publicKey) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const found = await worker.provider
        .query({ request_type: "view_access_key", account_id: accountId, public_key: publicKey, finality: "final" })
        .then(() => true, () => false);
      if (found) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`The key on ${accountId} did not become final.`);
  };
  const indent = (text) => text.trim().split("\n").map((line) => `      | ${line}`).join("\n");

  say("0. Upgrade the first version in place, as on mainnet");
  const before = await rules.view("rules");
  if (scriptsReady) {
    say("      running scripts/upgrade.mjs --send against this sandbox");
    await untilFinal(owner.accountId, ownerKey.getPublicKey().toString());
    await untilFinal(rulesId, ownerKey.getPublicKey().toString());
    say(indent(runScript("upgrade.mjs", ["--send"], { KYRONA_OWNER: owner.accountId, KYRONA_OWNER_KEY: ownerKey.toString() })));
  } else {
    say("      (run npm install at the root to have this step run scripts/upgrade.mjs itself)");
    const upgraded = await rules
      .batch(rules)
      .deployContract(readFileSync(V2_WASM))
      .functionCall("migrate", {}, { gas: 100n * TGAS })
      .transact();
    if (upgraded.failed) throw new Error(`Upgrade failed: ${JSON.stringify(upgraded.Failure)}`);
  }
  const after = await rules.view("rules");
  // The payments below need NEAR that is not locked for storage.
  const funded = await owner.batch(rules).transfer(near(5)).transact();
  if (funded.failed) throw new Error(`Funding the rules account failed: ${JSON.stringify(funded.Failure)}`);
  const kept = ["owner", "max_per_payment", "daily_cap", "open", "spent"].every((k) => after[k] === before[k]) &&
    JSON.stringify(after.allowed) === JSON.stringify(before.allowed) && after.waiting === 0;
  if (!kept) failures += 1;
  say(`${kept ? "ok  " : "FAIL"}  migrate keeps the owner, the list, the caps, the lock and today's spend`);
  check(
    "anyone calls migrate again to reset the rules",
    await attempt(() => owner.callRaw(rulesId, "migrate", {}, { gas: 30n * TGAS })),
    { outcome: "contract", why: "Only the rules account can migrate" },
  );
  say("");

  // The agent's key: a function-call key on the owner's account that can call `pay` and
  // `request` on the rules account and nothing else. NEAR enforces that limit, not this script.
  const agentKey = KeyPairEd25519.fromRandom();
  const added = await owner
    .batch(owner)
    .addKey(agentKey.getPublicKey(), transactions.functionCallAccessKey(rulesId, ["pay", "request"], KEY_ALLOWANCE))
    .transact();
  if (added.failed) throw new Error(`Adding the agent key failed: ${JSON.stringify(added.Failure)}`);
  say(`Agent key    ${agentKey.getPublicKey().toString()}`);
  say(`             may call only pay and request on ${rulesId}`);
  say("");

  const agentCalls = (method, args) =>
    attempt(() => owner.callRaw(rulesId, method, args, { signWithKey: agentKey, gas: 30n * TGAS }));
  const agentPays = (to, amount) => agentCalls("pay", { to, amount: amount.toString() });
  const balance = async (account) => BigInt((await account.accountView()).amount);
  const aliceBefore = await balance(alice);
  const malloryBefore = await balance(mallory);

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

  say("5. Outside the rules, the agent asks the owner instead");
  check(
    `request 0.4 NEAR for ${mallory.accountId}, note "new vendor"`,
    await agentCalls("request", { to: mallory.accountId, amount: near(0.4).toString(), note: "new vendor" }),
    { outcome: "paid" },
    "WAITING for the owner",
  );
  check(
    `request 5 NEAR for ${mallory.accountId}, note "urgent"`,
    await agentCalls("request", { to: mallory.accountId, amount: near(5).toString(), note: "urgent" }),
    { outcome: "paid" },
    "WAITING for the owner",
  );
  const waiting = await rules.view("requests");
  const nothingMoved = waiting.length === 2 && (await balance(mallory)) === malloryBefore;
  if (!nothingMoved) failures += 1;
  say(`${nothingMoved ? "ok  " : "FAIL"}  two requests wait, and ${mallory.accountId} has received nothing`);
  check(
    "the agent approves its own request",
    await agentCalls("approve", { id: waiting[0].id }),
    { outcome: "protocol", why: "MethodNameMismatch" },
  );
  check(
    `the owner approves request ${waiting[0].id} (0.4 NEAR)`,
    await attempt(() => owner.callRaw(rulesId, "approve", { id: waiting[0].id }, { gas: 30n * TGAS })),
    { outcome: "paid" },
  );
  check(
    `the owner rejects request ${waiting[1].id} (5 NEAR)`,
    await attempt(() => owner.callRaw(rulesId, "reject", { id: waiting[1].id }, { gas: 30n * TGAS })),
    { outcome: "paid" },
    "REJECTED, nothing moved",
  );
  check(
    `the owner approves request ${waiting[0].id} a second time`,
    await attempt(() => owner.callRaw(rulesId, "approve", { id: waiting[0].id }, { gas: 30n * TGAS })),
    { outcome: "contract", why: "No such request" },
  );
  say("");

  say("6. A payment that fails on the way does not use up the day");
  const listed = await owner.callRaw(rulesId, "set_rules", rulesArgs(true, [alice.accountId, ghost]));
  if (listed.failed) throw new Error(`set_rules failed: ${JSON.stringify(listed.Failure)}`);
  const spentBefore = BigInt((await rules.view("rules")).spent);
  const toGhost = await owner.callRaw(rulesId, "pay", { to: ghost, amount: near(0.05).toString() }, {
    signWithKey: agentKey,
    gas: 30n * TGAS,
  });
  const spentAfter = BigInt((await rules.view("rules")).spent);
  const rolledBack = toGhost.receiptFailureMessages.length > 0 && spentAfter === spentBefore;
  if (!rolledBack) failures += 1;
  say(`${rolledBack ? "ok  " : "FAIL"}  pay 0.05 NEAR to ${ghost}, an account that does not exist`);
  say(`      -> the transfer failed, the NEAR came back, today's spend stayed at ${fmt(spentAfter)} NEAR`);
  check(
    "the owner calls on_transfer to fake a failed payment",
    await attempt(() =>
      owner.callRaw(rulesId, "on_transfer", { amount: near(1).toString(), day: 0 }, { gas: 30n * TGAS }),
    ),
    { outcome: "contract", why: "is private" },
  );
  say("");

  say("7. The agent tries to get around the contract with its own key");
  check(
    `transfer 0.01 NEAR straight to ${mallory.accountId}`,
    await attempt(() => owner.batch(mallory).transfer(near(0.01)).transact(agentKey)),
    { outcome: "protocol", why: "RequiresFullAccess" },
  );
  check(
    `call set_rules to put ${mallory.accountId} on the list`,
    await agentCalls("set_rules", {
      max_per_payment: near(100).toString(),
      daily_cap: near(100).toString(),
      open: true,
      allowed: [mallory.accountId],
    }),
    { outcome: "protocol", why: "MethodNameMismatch" },
  );
  check(
    "add a full-access key for itself",
    await attempt(() => owner.batch(owner).addKey(KeyPairEd25519.fromRandom().getPublicKey()).transact(agentKey)),
    { outcome: "protocol", why: "RequiresFullAccess" },
  );
  say("");

  say("8. scripts/agent.mjs, the program that paid on mainnet, run against this sandbox");
  let agentPaid = 0n;
  if (scriptsReady) {
    await untilFinal(owner.accountId, agentKey.getPublicKey().toString());
    const out = runScript("agent.mjs", [], {
      KYRONA_ACCOUNT: owner.accountId,
      KYRONA_RULES: rulesId,
      KYRONA_PAYEE: alice.accountId,
      KYRONA_OUTSIDE: mallory.accountId,
      KYRONA_LIMITED_KEY: agentKey.toString(),
    });
    say(indent(out));
    agentPaid = near(0.01);
    const asked = await rules.view("requests");
    const waitsOnly = asked.length === 1 && asked[0].to === mallory.accountId;
    if (!waitsOnly) failures += 1;
    say(`${waitsOnly ? "ok  " : "FAIL"}  the agent's request for ${mallory.accountId} waits; nothing moved`);
    say("");

    say("9. scripts/llm-agent.mjs: an invoice with a hidden instruction, replayed as a hijacked model");
    say("      scripts/agent-key.mjs --send gives the agent its own key");
    const keyFile = join(mkdtempSync(join(tmpdir(), "kyrona-judge-")), "agent-key");
    say(indent(runScript("agent-key.mjs", ["--send"], { KYRONA_OWNER: owner.accountId, KYRONA_OWNER_KEY: ownerKey.toString(), KYRONA_KEY_FILE: keyFile })));
    const llmKey = readFileSync(keyFile, "utf8").trim();
    rmSync(keyFile, { force: true });
    await untilFinal(owner.accountId, KeyPair.fromString(llmKey).getPublicKey().toString());
    const malloryBeforeLlm = await balance(mallory);
    const llm = runScript("llm-agent.mjs", [], {
      KYRONA_LLM: "scripted",
      KYRONA_ACCOUNT: owner.accountId,
      KYRONA_RULES: rulesId,
      KYRONA_PAYEE: alice.accountId,
      KYRONA_OUTSIDE: mallory.accountId,
      KYRONA_LIMITED_KEY: llmKey,
    });
    say(indent(llm));
    agentPaid += near(0.01);
    const afterLlm = await rules.view("requests");
    const hijackHeld =
      (await balance(mallory)) === malloryBeforeLlm &&
      afterLlm.length === 2 &&
      afterLlm.some((r) => r.to === mallory.accountId && r.amount === near(5).toString()) &&
      llm.includes("REFUSED: Not on the list");
    if (!hijackHeld) failures += 1;
    say(`${hijackHeld ? "ok  " : "FAIL"}  the hijacked 5 NEAR payment was refused, its request waits, ${mallory.accountId} got nothing`);
  } else {
    say("      skipped: run npm install at the root to include it");
  }
  say("");

  if (scriptsReady) {
    say("10. The receiver check, before the agent signs anything");
    const scratch = mkdtempSync(join(tmpdir(), "kyrona-check-"));
    const pinsFile = join(scratch, "pins.json");
    const blocklistFile = join(scratch, "blocklist.json");
    writeFileSync(blocklistFile, JSON.stringify([{ account: mallory.accountId, reason: "test entry: drained a vault in this run", evidence: "judge/run.mjs" }]));
    const checkEnv = { KYRONA_PINS_FILE: pinsFile, KYRONA_BLOCKLIST: join(scratch, "none.json") };
    const verdictOf = (account, extra = {}, args = []) =>
      runScript("check-receiver.mjs", [account, ...args], { ...checkEnv, ...extra }, [0, 2]).trim();
    const expectVerdict = (label, out, word, reason) => {
      const ok = out.includes(` ${word}`) && (!reason || out.includes(reason));
      if (!ok) failures += 1;
      say(`${ok ? "ok  " : "FAIL"}  ${label}\n      -> ${out.split("\n")[0]}`);
    };
    expectVerdict(`${alice.accountId}, an ordinary account`, verdictOf(alice.accountId), "ALLOW");
    expectVerdict(`${ghost}, which does not exist`, verdictOf(ghost), "BLOCK", "does not exist");

    const shop = await root.createSubAccount("shop", { initialBalance: near(3) });
    await shop.deploy(readFileSync(V1_WASM));
    await untilFinalCode(shop.accountId, "GxfinPGWZYkt9ZpHwVsoBKAkcTtNwCKQFrsEVWKdAMyX");
    expectVerdict(`${shop.accountId}, a contract never paid before`, verdictOf(shop.accountId), "WARN", "contract not paid before");
    verdictOf(shop.accountId, {}, ["--pin"]);
    expectVerdict(`${shop.accountId} after the owner pins its code`, verdictOf(shop.accountId), "ALLOW");
    await shop.deploy(readFileSync(V2_WASM));
    await untilFinalCode(shop.accountId, "9S1DZHopohawkLoLnYGDqv1MAf5HjbJD1gSehkMQSRDV");
    expectVerdict(`${shop.accountId} after its code is swapped`, verdictOf(shop.accountId), "BLOCK", "code changed");
    expectVerdict(
      `${mallory.accountId} on a blocklist, with evidence`,
      verdictOf(mallory.accountId, { KYRONA_BLOCKLIST: blocklistFile }),
      "BLOCK",
      "shared blocklist",
    );

    say("      the hijacked agent again, with the stranger on the blocklist");
    const requestsBefore = (await rules.view("requests")).length;
    const malloryBeforeBlock = await balance(mallory);
    const blockedRun = runScript("llm-agent.mjs", [], {
      KYRONA_LLM: "scripted",
      KYRONA_ACCOUNT: owner.accountId,
      KYRONA_RULES: rulesId,
      KYRONA_PAYEE: alice.accountId,
      KYRONA_OUTSIDE: mallory.accountId,
      KYRONA_LIMITED_KEY: agentKey.toString(),
      KYRONA_PINS_FILE: pinsFile,
      KYRONA_BLOCKLIST: blocklistFile,
    });
    say(indent(blockedRun));
    agentPaid += near(0.01);
    const nothingSigned =
      (await balance(mallory)) === malloryBeforeBlock &&
      (await rules.view("requests")).length === requestsBefore &&
      (blockedRun.match(/blocked it before signing/g) ?? []).length === 2;
    if (!nothingSigned) failures += 1;
    say(`${nothingSigned ? "ok  " : "FAIL"}  the payment and the request to ${mallory.accountId} were blocked before signing; no request was filed`);
    rmSync(scratch, { recursive: true, force: true });
    say("");
  }

  say("11. The owner locks spending");
  const locked = await owner.callRaw(rulesId, "set_rules", rulesArgs(false, [alice.accountId]));
  if (locked.failed) throw new Error(`Locking failed: ${JSON.stringify(locked.Failure)}`);
  check(
    `pay 0.1 NEAR to ${alice.accountId} while locked`,
    await agentPays(alice.accountId, near(0.1)),
    { outcome: "contract", why: "Spending is locked" },
  );
  say("");

  const view = await rules.view("rules");
  const aliceGot = (await balance(alice)) - aliceBefore;
  const malloryGot = (await balance(mallory)) - malloryBefore;
  say("What moved");
  const aliceExpected = near(2.5) + agentPaid;
  const spentExpected = near(2.9) + agentPaid;
  say(`  ${alice.accountId} received ${fmt(aliceGot)} NEAR (expected ${fmt(aliceExpected)})`);
  say(`  ${mallory.accountId} received ${fmt(malloryGot)} NEAR (expected 0.4, the approved request)`);
  say(`  the contract records ${fmt(view.spent)} NEAR spent today (expected ${fmt(spentExpected)})`);
  if (aliceGot !== aliceExpected) failures += 1;
  if (malloryGot !== near(0.4)) failures += 1;
  if (BigInt(view.spent) !== spentExpected) failures += 1;
  say("");

  say(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
} catch (error) {
  failures += 1;
  say(`The run stopped: ${error?.stack ?? error}`);
} finally {
  await worker.tearDown().catch(() => {});
  if (process.env.GITHUB_ACTIONS) {
    // GitHub cuts long annotations, so the log goes out in parts.
    const parts = [];
    let part = "";
    for (const line of lines.join("\n").split("\n")) {
      if (part.length + line.length > 3000) {
        parts.push(part);
        part = "";
      }
      part += `${line}\n`;
    }
    parts.push(part);
    parts.forEach((text, index) => {
      const body = text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      console.log(`::notice title=Kyrona judge run ${index + 1}/${parts.length}::${body}`);
    });
  }
}
process.exit(failures === 0 ? 0 : 1);

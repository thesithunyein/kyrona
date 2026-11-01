import type { WalletSelector } from "@near-wallet-selector/core";
import { contractLive, ownerKey, ruleArgs, rulesAccount } from "./policy";
import type { Rules } from "./engine";
import { USDC_CONTRACT, USDC_STORAGE_DEPOSIT, needsUsdcRegistration, toUnits } from "./chain";
import { SOCIAL, deskData, socialDeposit, type DeskSnapshot } from "./account-desk";

function browserGlobals() {
  const g = globalThis as typeof globalThis & { global?: typeof globalThis; process?: { env: Record<string, string> } };
  g.global = g;
  g.process = g.process || { env: {} };
}

async function actions() {
  if (import.meta.env.SSR) throw new Error("Wallet runs in the browser.");
  const { actionCreators } = await import("@near-wallet-selector/core");
  return actionCreators;
}

let selectorPromise: Promise<WalletSelector> | null = null;

async function getSelector() {
  if (import.meta.env.SSR) throw new Error("Wallet runs in the browser.");
  if (!selectorPromise) {
    selectorPromise = (async () => {
      browserGlobals();
      const { Buffer } = await import("buffer");
      (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
      const [{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
      ]);
      return setupWalletSelector({
        network: "mainnet",
        modules: [setupMyNearWallet(), setupMeteorWallet()],
      });
    })().catch((error) => {
      selectorPromise = null;
      throw error;
    });
  }
  return selectorPromise;
}

export async function restoreWallet() {
  const selector = await getSelector();
  const wallet = await selector.wallet().catch(() => null);
  const accounts = wallet ? await wallet.getAccounts() : [];
  return accounts[0]?.accountId ?? null;
}

export async function connectWallet() {
  const selector = await getSelector();
  const existing = await restoreWallet();
  if (existing) return existing;
  if (import.meta.env.SSR) throw new Error("Wallet runs in the browser.");
  const { setupModal } = await import("@near-wallet-selector/modal-ui");
  await import("@near-wallet-selector/modal-ui/styles.css");
  const modal = setupModal(selector, { description: "Kyrona uses this account to read balances and send." });
  modal.show();
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Wallet window closed.")), 180000);
    const sub = selector.on("signedIn", ({ accounts }) => {
      window.clearTimeout(timeout);
      sub.remove();
      modal.hide();
      const id = accounts[0]?.accountId;
      if (!id) reject(new Error("No account returned."));
      else resolve(id);
    });
  });
}

export async function disconnectWallet() {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  await wallet.signOut();
}

export async function sendOnNear(input: {
  signerId: string;
  receiverId: string;
  asset: "USDC" | "NEAR";
  amount: string;
  memo: string;
}) {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  if (input.asset === "NEAR") {
    const near = await actions();
    const outcome = await wallet.signAndSendTransaction({
      signerId: input.signerId,
      receiverId: input.receiverId,
      actions: [near.transfer(BigInt(toUnits(input.amount, 24)))],
    });
    return hashOf(outcome);
  }
  const near = await actions();
  const calls = [];
  if (await needsUsdcRegistration(input.receiverId)) {
    calls.push(
      near.functionCall(
        "storage_deposit",
        { account_id: input.receiverId, registration_only: true },
        30_000_000_000_000n,
        BigInt(USDC_STORAGE_DEPOSIT),
      ),
    );
  }
  calls.push(
    near.functionCall(
      "ft_transfer",
      { receiver_id: input.receiverId, amount: toUnits(input.amount, 6), memo: input.memo },
      30_000_000_000_000n,
      1n,
    ),
  );
  const outcome = await wallet.signAndSendTransaction({
    signerId: input.signerId,
    receiverId: USDC_CONTRACT,
    actions: calls,
  });
  return hashOf(outcome);
}

const LIMITED = "kyrona-limited-key:";
const GAS = 50_000_000_000_000n;
const LIMITED_GAS = 20_000_000_000_000n;
const KEY_ALLOWANCE = 250_000_000_000_000_000_000_000n;

export function limitedKeyStored(accountId: string) {
  return typeof localStorage !== "undefined" && Boolean(localStorage.getItem(LIMITED + accountId));
}

export async function putRulesOnChain(accountId: string, rules: Rules) {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const near = await actions();
  const args = ruleArgs(rules);
  const contractId = rulesAccount(accountId);
  const live = await contractLive(accountId);
  const calls = live
    ? [near.functionCall("set_rules", args, GAS, 0n)]
    : await deployActions(accountId, near, args);
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: contractId,
    actions: calls,
  });
  return hashOf(outcome);
}

export async function putRulesWithKey(accountId: string, rules: Rules, secret: string) {
  if (import.meta.env.SSR) throw new Error("This runs in the browser.");
  const trimmed = secret.trim();
  if (!trimmed.startsWith("ed25519:")) throw new Error("Paste the private key from Meteor. It starts with ed25519.");
  const [{ KeyPairSigner }, { JsonRpcProvider }, { Account }] = await Promise.all([
    import("@near-js/signers"),
    import("@near-js/providers"),
    import("@near-js/accounts"),
  ]);
  const near = await actions();
  const args = ruleArgs(rules);
  const contractId = rulesAccount(accountId);
  const live = await contractLive(accountId);
  const calls = live ? [near.functionCall("set_rules", args, GAS, 0n)] : await deployActions(accountId, near, args);
  const account = new Account(
    accountId,
    new JsonRpcProvider({ url: "https://free.rpc.fastnear.com" }),
    KeyPairSigner.fromSecretKey(trimmed as `ed25519:${string}`),
  );
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: calls,
    throwOnFailure: true,
  });
  return hashOf(outcome);
}

async function deployActions(
  accountId: string,
  near: Awaited<ReturnType<typeof actions>>,
  args: ReturnType<typeof ruleArgs>,
) {
  const { PublicKey } = await import("@near-js/crypto");
  const wasm = new Uint8Array(await (await fetch("/kyrona.wasm")).arrayBuffer());
  const fund = BigInt(wasm.length) * 10_000_000_000_000_000_000n + 50_000_000_000_000_000_000_000n;
  return [
    near.createAccount(),
    near.transfer(fund),
    near.addKey(PublicKey.from(await ownerKey(accountId)), near.fullAccessKey()),
    near.deployContract(wasm),
    near.functionCall("new", args, GAS, 0n),
  ];
}

export async function addLimitedPayKey(accountId: string) {
  if (import.meta.env.SSR) throw new Error("Wallet runs in the browser.");
  const { KeyPair } = await import("@near-js/crypto");
  const pair = KeyPair.fromRandom("ed25519");
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const near = await actions();
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: accountId,
    actions: [near.addKey(pair.getPublicKey(), near.functionCallAccessKey(rulesAccount(accountId), ["pay"], KEY_ALLOWANCE))],
  });
  localStorage.setItem(LIMITED + accountId, pair.toString());
  return hashOf(outcome);
}

export async function payThroughWallet(accountId: string, receiverId: string, amount: string) {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const near = await actions();
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: rulesAccount(accountId),
    actions: [near.functionCall("pay", { to: receiverId, amount: toUnits(amount, 24) }, GAS, 0n)],
  });
  return hashOf(outcome);
}

export async function payWithLimitedKey(accountId: string, receiverId: string, amount: string) {
  const near = await actions();
  const outcome = await signLimited(accountId, rulesAccount(accountId), [
    near.functionCall("pay", { to: receiverId, amount: toUnits(amount, 24) }, LIMITED_GAS, 0n),
  ]);
  return hashOf(outcome);
}

export async function showKeyLimits(accountId: string) {
  const near = await actions();
  const contractId = rulesAccount(accountId);
  const pay = await signLimited(accountId, contractId, [near.functionCall("pay", { to: "outside.near", amount: "1" }, LIMITED_GAS, 0n)]).then(
    () => "The unknown account was paid. That should not happen.",
    (error: unknown) => textOf(error),
  );
  const transfer = await signLimited(accountId, accountId, [near.transfer(1n)]).then(
    () => "The limited key transferred NEAR. That should not happen.",
    (error: unknown) => textOf(error),
  );
  return { pay, transfer };
}

async function signLimited(
  accountId: string,
  receiverId: string,
  calls: ReturnType<Awaited<ReturnType<typeof actions>>["transfer"]>[],
) {
  if (import.meta.env.SSR) throw new Error("Wallet runs in the browser.");
  const secret = localStorage.getItem(LIMITED + accountId);
  if (!secret) throw new Error("Add the limited key on this browser first.");
  const [{ KeyPairSigner }, { JsonRpcProvider }, { Account }] = await Promise.all([
    import("@near-js/signers"),
    import("@near-js/providers"),
    import("@near-js/accounts"),
  ]);
  const signer = KeyPairSigner.fromSecretKey(secret as `${"ed25519" | "secp256k1"}:${string}`);
  const account = new Account(accountId, new JsonRpcProvider({ url: "https://free.rpc.fastnear.com" }), signer);
  return account.signAndSendTransaction({
    receiverId,
    actions: calls,
    throwOnFailure: true,
  });
}

export async function saveDeskOnAccount(accountId: string, snapshot: DeskSnapshot) {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const near = await actions();
  const data = deskData(accountId, snapshot);
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: SOCIAL,
    actions: [near.functionCall("set", { data }, 100_000_000_000_000n, BigInt(socialDeposit(data)))],
  });
  return hashOf(outcome);
}

function textOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 220);
}

function hashOf(outcome: unknown) {
  if (!outcome || typeof outcome !== "object" || !("transaction" in outcome)) {
    throw new Error("The wallet did not return a transaction.");
  }
  const transaction = outcome.transaction;
  const hash = transaction && typeof transaction === "object" && "hash" in transaction ? String(transaction.hash) : "";
  if (!hash) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

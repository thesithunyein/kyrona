import { actionCreators, type WalletSelector } from "@near-wallet-selector/core";
import { USDC_CONTRACT, USDC_STORAGE_DEPOSIT, needsUsdcRegistration, toUnits } from "./chain";
import { SOCIAL, deskData, socialDeposit, type DeskSnapshot } from "./account-desk";

let selectorPromise: Promise<WalletSelector> | null = null;

async function getSelector() {
  if (!selectorPromise) {
    selectorPromise = (async () => {
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
    })();
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
    const outcome = await wallet.signAndSendTransaction({
      signerId: input.signerId,
      receiverId: input.receiverId,
      actions: [actionCreators.transfer(BigInt(toUnits(input.amount, 24)))],
    });
    return hashOf(outcome);
  }
  const actions = [];
  if (await needsUsdcRegistration(input.receiverId)) {
    actions.push(
      actionCreators.functionCall(
        "storage_deposit",
        { account_id: input.receiverId, registration_only: true },
        30_000_000_000_000n,
        BigInt(USDC_STORAGE_DEPOSIT),
      ),
    );
  }
  actions.push(
    actionCreators.functionCall(
      "ft_transfer",
      { receiver_id: input.receiverId, amount: toUnits(input.amount, 6), memo: input.memo },
      30_000_000_000_000n,
      1n,
    ),
  );
  const outcome = await wallet.signAndSendTransaction({
    signerId: input.signerId,
    receiverId: USDC_CONTRACT,
    actions,
  });
  return hashOf(outcome);
}

export async function saveDeskOnAccount(accountId: string, snapshot: DeskSnapshot) {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  const data = deskData(accountId, snapshot);
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: SOCIAL,
    actions: [
      actionCreators.functionCall("set", { data }, 100_000_000_000_000n, BigInt(socialDeposit(data))),
    ],
  });
  return hashOf(outcome);
}

function hashOf(outcome: unknown) {
  if (!outcome || typeof outcome !== "object" || !("transaction" in outcome)) {
    throw new Error("The wallet did not return a transaction.");
  }
  const transaction = outcome.transaction;
  const hash =
    transaction && typeof transaction === "object" && "hash" in transaction ? String(transaction.hash) : "";
  if (!hash) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

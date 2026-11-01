import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_RULES, type Decision, type Recipient, type Rules, STARTING } from "./engine";
import { writeLocalDesk } from "./account-desk";

type Balances = { near: number; usdc: number };

type DeskState = {
  rules: Rules;
  decisions: Decision[];
  balances: Balances;
  accountId: string | null;
  deskSavedAt: number;
  setRules: (patch: Partial<Rules>) => void;
  setBalances: (patch: Partial<Balances>) => void;
  setAccount: (accountId: string | null) => void;
  replaceDesk: (rules: Rules, decisions: Decision[], savedAt: number) => void;
  toggleAsset: (asset: Rules["allowedAssets"][number]) => void;
  addRecipient: (person: Omit<Recipient, "id">) => void;
  removeRecipient: (id: string) => void;
  record: (decision: Decision) => void;
  reset: () => void;
};

const initial = {
  rules: DEFAULT_RULES,
  decisions: [] as Decision[],
  balances: { ...STARTING },
  accountId: null as string | null,
  deskSavedAt: 0,
};

export const useDesk = create<DeskState>()(
  persist(
    (set) => ({
      ...initial,
      setRules: (patch) => set((s) => ({ rules: { ...s.rules, ...patch }, deskSavedAt: Date.now() })),
      setBalances: (patch) => set((s) => ({ balances: { ...s.balances, ...patch } })),
      setAccount: (accountId) => set({ accountId }),
      replaceDesk: (rules, decisions, savedAt) => set({ rules, decisions, deskSavedAt: savedAt }),
      toggleAsset: (asset) =>
        set((s) => {
          const has = s.rules.allowedAssets.includes(asset);
          const next = has
            ? s.rules.allowedAssets.filter((a) => a !== asset)
            : [...s.rules.allowedAssets, asset];
          return { rules: { ...s.rules, allowedAssets: next.length ? next : s.rules.allowedAssets }, deskSavedAt: Date.now() };
        }),
      addRecipient: (person) =>
        set((s) => ({
          rules: {
            ...s.rules,
            recipients: [...s.rules.recipients, { ...person, id: crypto.randomUUID() }],
          },
          deskSavedAt: Date.now(),
        })),
      removeRecipient: (id) =>
        set((s) => ({
          rules: { ...s.rules, recipients: s.rules.recipients.filter((r) => r.id !== id) },
          deskSavedAt: Date.now(),
        })),
      record: (decision) =>
        set((s) => {
          const balances = { ...s.balances };
          if (decision.status === "authorized") {
            if (decision.proposal.asset === "USDC") balances.usdc = round2(balances.usdc - decision.proposal.amount);
            else balances.near = round2(balances.near - decision.proposal.amount);
          }
          return { decisions: [decision, ...s.decisions].slice(0, 20), balances, deskSavedAt: Date.now() };
        }),
      reset: () =>
        set((s) => ({
          rules: structuredClone(DEFAULT_RULES),
          decisions: [],
          balances: s.accountId ? s.balances : { ...STARTING },
          accountId: s.accountId,
          deskSavedAt: Date.now(),
        })),
    }),
    { name: "kyrona-desk-v2" },
  ),
);

if (typeof window !== "undefined") {
  useDesk.subscribe((state) => {
    if (!state.accountId || !state.deskSavedAt) return;
    writeLocalDesk(state.accountId, {
      v: 1,
      savedAt: state.deskSavedAt,
      rules: state.rules,
      decisions: state.decisions.slice(0, 20),
    });
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

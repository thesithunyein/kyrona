import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_RULES, type Decision, type Recipient, type Rules, STARTING } from "./engine";

type Balances = { near: number; usdc: number };

type DeskState = {
  rules: Rules;
  decisions: Decision[];
  balances: Balances;
  setRules: (patch: Partial<Rules>) => void;
  setBalances: (patch: Partial<Balances>) => void;
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
};

export const useDesk = create<DeskState>()(
  persist(
    (set) => ({
      ...initial,
      setRules: (patch) => set((s) => ({ rules: { ...s.rules, ...patch } })),
      setBalances: (patch) => set((s) => ({ balances: { ...s.balances, ...patch } })),
      toggleAsset: (asset) =>
        set((s) => {
          const has = s.rules.allowedAssets.includes(asset);
          const next = has
            ? s.rules.allowedAssets.filter((a) => a !== asset)
            : [...s.rules.allowedAssets, asset];
          return { rules: { ...s.rules, allowedAssets: next.length ? next : s.rules.allowedAssets } };
        }),
      addRecipient: (person) =>
        set((s) => ({
          rules: {
            ...s.rules,
            recipients: [...s.rules.recipients, { ...person, id: crypto.randomUUID() }],
          },
        })),
      removeRecipient: (id) =>
        set((s) => ({
          rules: { ...s.rules, recipients: s.rules.recipients.filter((r) => r.id !== id) },
        })),
      record: (decision) =>
        set((s) => {
          const balances = { ...s.balances };
          if (decision.status === "authorized") {
            if (decision.proposal.asset === "USDC") balances.usdc = round2(balances.usdc - decision.proposal.amount);
            else balances.near = round2(balances.near - decision.proposal.amount);
          }
          return { decisions: [decision, ...s.decisions].slice(0, 80), balances };
        }),
      reset: () => set({ ...initial, rules: structuredClone(DEFAULT_RULES), balances: { ...STARTING } }),
    }),
    { name: "kyrona-desk-v2" },
  ),
);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

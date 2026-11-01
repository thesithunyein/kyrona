import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_RULES,
  type Decision,
  type Rules,
  spentToday,
  STARTING,
  usdValue,
} from "./engine";

type Balances = { near: number; usdc: number };

type DeskState = {
  rules: Rules;
  decisions: Decision[];
  balances: Balances;
  setRules: (patch: Partial<Rules>) => void;
  toggleAsset: (asset: Rules["allowedAssets"][number]) => void;
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
      toggleAsset: (asset) =>
        set((s) => {
          const has = s.rules.allowedAssets.includes(asset);
          const next = has
            ? s.rules.allowedAssets.filter((a) => a !== asset)
            : [...s.rules.allowedAssets, asset];
          return { rules: { ...s.rules, allowedAssets: next.length ? next : s.rules.allowedAssets } };
        }),
      record: (decision) =>
        set((s) => {
          const balances = { ...s.balances };
          if (decision.status === "authorized") {
            if (decision.proposal.asset === "USDC") balances.usdc = round2(balances.usdc - decision.proposal.amount);
            else balances.near = round2(balances.near - decision.proposal.amount);
          }
          return { decisions: [decision, ...s.decisions].slice(0, 24), balances };
        }),
      reset: () => set({ ...initial, rules: structuredClone(DEFAULT_RULES), balances: { ...STARTING } }),
    }),
    { name: "kyrona-desk-v1" },
  ),
);

export function selectSpent(decisions: Decision[]) {
  return spentToday(decisions);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function treasuryUsd(balances: Balances) {
  return Math.round((balances.usdc + balances.near * 4.2) * 100) / 100;
}

export { usdValue };

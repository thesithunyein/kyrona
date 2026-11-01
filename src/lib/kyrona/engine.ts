export type Asset = "USDC" | "NEAR";

export type Recipient = {
  id: string;
  label: string;
  account: string;
  role: string;
};

export type Rules = {
  maxUsdc: number;
  dailyUsdc: number;
  maxNear: number;
  dailyNear: number;
  allowedAssets: Asset[];
  recipients: Recipient[];
  killSwitch: boolean;
};

export type Proposal = {
  id: string;
  goal: string;
  asset: Asset;
  amount: number;
  recipientId: string | null;
  unknownAccount?: string;
  memo: string;
};

export type Check = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type DecisionStatus = "authorized" | "blocked";

export type Decision = {
  id: string;
  at: number;
  proposal: Proposal;
  checks: Check[];
  status: DecisionStatus;
  proposalHash: string;
  txHash: string | null;
  spentAfter: number;
};

export const STARTING = { near: 0, usdc: 0 };

export const DEFAULT_RULES: Rules = {
  maxUsdc: 100,
  dailyUsdc: 500,
  maxNear: 20,
  dailyNear: 50,
  allowedAssets: ["USDC", "NEAR"],
  killSwitch: false,
  recipients: [],
};

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function spentToday(decisions: Decision[], asset: Asset, ts = Date.now()) {
  const key = dayKey(ts);
  return decisions
    .filter((d) => d.status === "authorized" && d.proposal.asset === asset && dayKey(d.at) === key)
    .reduce((sum, d) => sum + d.proposal.amount, 0);
}

export function recipientOf(rules: Rules, proposal: Proposal) {
  if (!proposal.recipientId) return null;
  return rules.recipients.find((r) => r.id === proposal.recipientId) ?? null;
}

export function evaluate(rules: Rules, proposal: Proposal, alreadySpent: number): Check[] {
  const recipient = recipientOf(rules, proposal);
  const account = recipient?.account ?? proposal.unknownAccount ?? "—";
  const max = proposal.asset === "USDC" ? rules.maxUsdc : rules.maxNear;
  const daily = proposal.asset === "USDC" ? rules.dailyUsdc : rules.dailyNear;
  const unit = proposal.asset === "USDC" ? "$" : "";
  const suffix = proposal.asset === "NEAR" ? " NEAR" : "";

  return [
    {
      id: "kill",
      label: "Spending lock",
      pass: !rules.killSwitch,
      detail: rules.killSwitch ? "Spending is locked. Nothing can be approved." : "Spending is open.",
    },
    {
      id: "asset",
      label: "Asset",
      pass: rules.allowedAssets.includes(proposal.asset),
      detail: rules.allowedAssets.includes(proposal.asset)
        ? `${proposal.asset} is allowed.`
        : `${proposal.asset} is turned off.`,
    },
    {
      id: "who",
      label: "Recipient",
      pass: Boolean(recipient),
      detail: recipient ? `${recipient.label} · ${recipient.account}` : `${account} is not on your list.`,
    },
    {
      id: "tx",
      label: "Per payment",
      pass: proposal.amount > 0 && proposal.amount <= max,
      detail:
        proposal.amount <= max
          ? `${unit}${proposal.amount}${suffix} is within the ${unit}${max}${suffix} limit.`
          : `${unit}${proposal.amount}${suffix} is over the ${unit}${max}${suffix} limit.`,
    },
    {
      id: "day",
      label: "Today",
      pass: alreadySpent + proposal.amount <= daily,
      detail:
        alreadySpent + proposal.amount <= daily
          ? `${unit}${round2(alreadySpent + proposal.amount)}${suffix} of ${unit}${daily}${suffix} used today.`
          : `Would use ${unit}${round2(alreadySpent + proposal.amount)}${suffix} of a ${unit}${daily}${suffix} daily limit.`,
    },
  ];
}

export function hashText(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex}${hex.split("").reverse().join("")}${hex}`;
}

export function shortHash(hex: string) {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

export function money(asset: Asset, amount: number) {
  const n = amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return asset === "USDC" ? `$${n}` : `${n} NEAR`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

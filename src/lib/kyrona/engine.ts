export type Asset = "USDC" | "NEAR";

export type Recipient = {
  id: string;
  label: string;
  account: string;
  role: string;
};

export type Rules = {
  maxPerTx: number;
  dailyCap: number;
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

export const STARTING = {
  near: 420,
  usdc: 1840,
};

export const DEFAULT_RULES: Rules = {
  maxPerTx: 50,
  dailyCap: 200,
  allowedAssets: ["USDC", "NEAR"],
  killSwitch: false,
  recipients: [
    {
      id: "ava",
      label: "Ava Chen",
      account: "ava.near",
      role: "Approved contractor",
    },
    {
      id: "studio",
      label: "Northline Studio",
      account: "northline.near",
      role: "Retainer",
    },
  ],
};

export const PRESETS: { id: string; title: string; hint: string; proposal: Omit<Proposal, "id"> }[] = [
  {
    id: "pay-40",
    title: "Pay Ava $40",
    hint: "Inside every rule",
    proposal: {
      goal: "Pay my approved contractor $40 in USDC.",
      asset: "USDC",
      amount: 40,
      recipientId: "ava",
      memo: "Invoice NL-184 · research brief",
    },
  },
  {
    id: "pay-150",
    title: "Pay Ava $150",
    hint: "Over the transaction limit",
    proposal: {
      goal: "Pay my approved contractor $150 in USDC.",
      asset: "USDC",
      amount: 150,
      recipientId: "ava",
      memo: "Invoice NL-185 · rush",
    },
  },
  {
    id: "stranger",
    title: "Pay an unknown wallet",
    hint: "Recipient not on the list",
    proposal: {
      goal: "Send $20 USDC to a new address.",
      asset: "USDC",
      amount: 20,
      recipientId: null,
      unknownAccount: "9f3c…c21a.near",
      memo: "Unsolicited request",
    },
  },
];

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function spentToday(decisions: Decision[], ts = Date.now()) {
  const key = dayKey(ts);
  return decisions
    .filter((d) => d.status === "authorized" && dayKey(d.at) === key)
    .reduce((sum, d) => sum + usdValue(d.proposal), 0);
}

export function usdValue(p: Pick<Proposal, "asset" | "amount">) {
  if (p.asset === "USDC") return p.amount;
  return Math.round(p.amount * 4.2 * 100) / 100;
}

export function recipientOf(rules: Rules, proposal: Proposal) {
  if (!proposal.recipientId) return null;
  return rules.recipients.find((r) => r.id === proposal.recipientId) ?? null;
}

export function evaluate(rules: Rules, proposal: Proposal, alreadySpent: number): Check[] {
  const recipient = recipientOf(rules, proposal);
  const value = usdValue(proposal);
  const account = recipient?.account ?? proposal.unknownAccount ?? "—";

  return [
    {
      id: "kill",
      label: "Kill switch",
      pass: !rules.killSwitch,
      detail: rules.killSwitch
        ? "Spending is frozen. Nothing can settle."
        : "Spending is open.",
    },
    {
      id: "asset",
      label: "Asset allowlist",
      pass: rules.allowedAssets.includes(proposal.asset),
      detail: rules.allowedAssets.includes(proposal.asset)
        ? `${proposal.asset} is allowed.`
        : `${proposal.asset} is not on the allowlist.`,
    },
    {
      id: "who",
      label: "Approved recipient",
      pass: Boolean(recipient),
      detail: recipient
        ? `${recipient.label} · ${recipient.account}`
        : `${account} is not an approved recipient.`,
    },
    {
      id: "tx",
      label: "Transaction limit",
      pass: value <= rules.maxPerTx,
      detail:
        value <= rules.maxPerTx
          ? `$${value} is within the $${rules.maxPerTx} cap.`
          : `$${value} exceeds the $${rules.maxPerTx} per-transaction cap.`,
    },
    {
      id: "day",
      label: "Daily budget",
      pass: alreadySpent + value <= rules.dailyCap,
      detail:
        alreadySpent + value <= rules.dailyCap
          ? `$${alreadySpent + value} of $${rules.dailyCap} used today after this payment.`
          : `Would use $${alreadySpent + value} of a $${rules.dailyCap} daily cap.`,
    },
    {
      id: "keys",
      label: "No full-access key",
      pass: true,
      detail: "The agent only produced a proposal. It cannot sign.",
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
  const n = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return asset === "USDC" ? `$${n}` : `${n} NEAR`;
}

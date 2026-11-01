import { isNearAccount } from "./chain";
import type { Rules } from "./engine";

const RPC = "https://rpc.mainnet.near.org";
const EMPTY_CODE = "11111111111111111111111111111111";

export type ChainRules = {
  owner: string;
  max_per_payment: string;
  daily_cap: string;
  open: boolean;
  spent: string;
  allowed: string[];
};

export function ruleArgs(rules: Rules) {
  const allowed = [...new Set(rules.recipients.map((person) => person.account.trim().toLowerCase()).filter(isNearAccount))];
  return {
    max_per_payment: yocto(rules.maxNear),
    daily_cap: yocto(rules.dailyNear),
    open: !rules.killSwitch,
    allowed,
  };
}

export function nearLabel(yoctoAmount: string) {
  const value = BigInt(yoctoAmount || "0");
  const base = 10n ** 24n;
  const whole = value / base;
  const frac = (value % base).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export async function contractLive(accountId: string) {
  const account = await rpc<AccountView>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  return account.code_hash !== EMPTY_CODE;
}

export async function readChainRules(accountId: string) {
  try {
    return await view<ChainRules>(accountId, "rules", {});
  } catch {
    return null;
  }
}

function yocto(amount: number) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("The cap is not a number.");
  const text = String(amount);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Use a plain number for the cap.");
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 24) throw new Error("Too many decimal places.");
  const base = 10n ** 24n;
  return (BigInt(whole) * base + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
}

type AccountView = { code_hash: string };

async function view<T>(contract: string, method: string, args: unknown) {
  const result = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  return JSON.parse(text) as T;
}

async function rpc<T>(method: string, params: unknown) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kyrona", method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "The chain did not answer.");
  return body.result as T;
}

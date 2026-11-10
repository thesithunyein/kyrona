import { isNearAccount } from "./chain";
import type { Rules } from "./engine";

const RPCS = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org", "https://rpc.intea.rs"];
const EMPTY_CODE = "11111111111111111111111111111111";

export type ChainRules = {
  owner: string;
  max_per_payment: string;
  daily_cap: string;
  open: boolean;
  spent: string;
  allowed: string[];
  /** Requests waiting for the owner. Missing on the first version of the contract. */
  waiting?: number;
};

export type ChainRequest = {
  id: number;
  to: string;
  amount: string;
  note: string;
  at_ms: number;
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

export function rulesAccount(accountId: string) {
  if (!accountId.endsWith(".near")) throw new Error("This account cannot own a rules account.");
  return `rules.${accountId}`;
}

export async function ownerKey(accountId: string) {
  const result = await rpc<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: accountId,
  });
  const key = result.keys.find((item) => item.access_key.permission === "FullAccess");
  if (!key) throw new Error("This account has no full access key.");
  return key.public_key;
}

export async function contractLive(accountId: string) {
  try {
    const account = await rpc<AccountView>("query", {
      request_type: "view_account",
      finality: "final",
      account_id: rulesAccount(accountId),
    });
    return account.code_hash !== EMPTY_CODE;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("does not exist") || message.includes("UNKNOWN_ACCOUNT")) return false;
    throw error;
  }
}

export async function readChainRules(accountId: string) {
  try {
    return await view<ChainRules>(rulesAccount(accountId), "rules", {});
  } catch {
    return null;
  }
}

/** Waiting requests, or null when the rules account runs the first version, which has none. */
export async function readRequests(accountId: string) {
  try {
    return await view<ChainRequest[]>(rulesAccount(accountId), "requests", {});
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
  let last = "The chain did not answer.";
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "kyrona", method, params }),
      });
      if (!response.ok) {
        last = `${url} returned ${response.status}`;
        continue;
      }
      const body = (await response.json()) as { result?: T; error?: { message?: string; data?: unknown } };
      if (body.error) {
        const detail = body.error.data ? JSON.stringify(body.error.data) : "";
        const message = `${body.error.message || "The chain did not answer."} ${detail}`;
        if (message.includes("does not exist") || message.includes("UNKNOWN_ACCOUNT")) throw new Error(message);
        last = message.slice(0, 180);
        continue;
      }
      return body.result as T;
    } catch (error) {
      if (error instanceof Error && (error.message.includes("does not exist") || error.message.includes("UNKNOWN_ACCOUNT"))) throw error;
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new Error(last);
}

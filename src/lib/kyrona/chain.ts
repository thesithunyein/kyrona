const RPC = "https://free.rpc.fastnear.com";
export const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export function isNearAccount(id: string) {
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id) && id.length >= 2 && id.length <= 64;
}

export function toUnits(amount: string, decimals: number) {
  const cleaned = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error("Enter a plain amount.");
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > decimals) throw new Error("Too many decimal places.");
  const base = 10n ** BigInt(decimals);
  return (BigInt(whole) * base + BigInt((frac + "0".repeat(decimals)).slice(0, decimals))).toString();
}

export function formatUnits(raw: string, decimals: number) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = frac ? `${whole}.${frac.slice(0, 6)}` : `${whole}`;
  return Number(text);
}

export async function readBalances(accountId: string) {
  const account = await rpc({
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  const usdcRaw = await view<string>(USDC_CONTRACT, "ft_balance_of", { account_id: accountId }).catch(() => "0");
  return {
    near: formatUnits(String(account.amount), 24),
    usdc: formatUnits(String(usdcRaw).replaceAll('"', ""), 6),
  };
}

async function view<T>(contract: string, method: string, args: unknown) {
  const result = await rpc({
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  const bytes = result.result as number[];
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return JSON.parse(text) as T;
}

export async function needsUsdcRegistration(accountId: string) {
  const balance = await view<unknown>(USDC_CONTRACT, "storage_balance_of", { account_id: accountId });
  return balance == null;
}

export const USDC_STORAGE_DEPOSIT = "1250000000000000000000";

async function rpc(params: Record<string, unknown>) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kyrona", method: "query", params }),
  });
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (!response.ok || body.error || !body.result) {
    throw new Error(body.error?.message || "NEAR did not answer.");
  }
  return body.result;
}

import type { Decision, Rules } from "./engine";

const SOCIAL = "social.near";
const RPC = "https://rpc.mainnet.near.org";

export type DeskSnapshot = {
  v: 1;
  savedAt: number;
  rules: Rules;
  decisions: Decision[];
};

function key(accountId: string) {
  return `kyrona-account-v1:${accountId}`;
}

export function readLocalDesk(accountId: string): DeskSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key(accountId));
  if (!raw) return null;
  return parseSnapshot(raw);
}

export function writeLocalDesk(accountId: string, snapshot: DeskSnapshot) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key(accountId), JSON.stringify(snapshot));
}

export async function loadSharedDesk(accountId: string): Promise<DeskSnapshot | null> {
  const result = await socialGet([`${accountId}/kyrona`]);
  const leaf = result?.[accountId]?.kyrona;
  const text = typeof leaf === "string" ? leaf : null;
  return text ? parseSnapshot(text) : null;
}

export function deskData(accountId: string, snapshot: DeskSnapshot) {
  return {
    [accountId]: {
      kyrona: JSON.stringify(snapshot),
    },
  };
}

export function socialDeposit(data: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  return (BigInt(bytes) * 10n ** 19n + 5_000n * 10n ** 19n).toString();
}

function parseSnapshot(raw: string): DeskSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as DeskSnapshot;
    if (parsed?.v !== 1 || !parsed.rules || !Array.isArray(parsed.decisions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function socialGet(keys: string[]) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kyrona",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: SOCIAL,
        method_name: "get",
        args_base64: btoa(JSON.stringify({ keys })),
      },
    }),
  });
  const body = (await response.json()) as { result?: { result?: number[] }; error?: { message?: string } };
  if (!body.result?.result) return null;
  const text = new TextDecoder().decode(new Uint8Array(body.result.result));
  return JSON.parse(text) as Record<string, { kyrona?: string }>;
}

export { SOCIAL };

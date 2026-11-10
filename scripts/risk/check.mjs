// The receiver check: before the agent signs a payment, look at who it is paying.
//
// verdict() turns what is known about a receiver into allow, warn or block, with the reasons.
// gather() reads those facts from NEAR (the account and its code) and, when one is available,
// an indexer (the account's age). Neither needs any package: the caller passes in an RPC
// `view_account` function, so the verdict can be tested without a network.
//
// block means the agent does not sign. warn means a person decides: a payment becomes a request
// the owner approves or rejects on the desk. allow means the contract's own rules still apply.

import { readFileSync, writeFileSync } from "node:fs";

export const NEW_ACCOUNT_DAYS = 7;
export const EMPTY_CODE = "11111111111111111111111111111111";

const IMPLICIT = /^([0-9a-f]{64}|0x[0-9a-f]{40})$/;

/**
 * @param {object} s
 * @param {string} s.account
 * @param {boolean|null} s.exists        null when the account could not be read
 * @param {string|null} s.codeHash       EMPTY_CODE for an account without a contract
 * @param {string|null} s.pinnedHash     the code hash recorded when the owner last approved it
 * @param {number|null} s.ageDays        null when no indexer answered
 * @param {{reason: string, evidence: string}|null} s.listed  an entry on the shared blocklist
 */
export function verdict(s) {
  const reasons = [];
  const add = (level, text) => reasons.push({ level, text });

  if (s.listed) add("block", `on the shared blocklist: ${s.listed.reason} (evidence: ${s.listed.evidence})`);
  if (s.exists === null) add("warn", "the account could not be read");
  if (s.exists === false) {
    if (IMPLICIT.test(s.account)) add("warn", "an implicit account that does not exist yet; a payment would create it");
    else add("block", "the account does not exist");
  }
  if (s.exists && s.codeHash && s.codeHash !== EMPTY_CODE) {
    if (!s.pinnedHash) add("warn", `a contract not paid before (code ${s.codeHash.slice(0, 8)}…)`);
    else if (s.pinnedHash !== s.codeHash) {
      add("block", `its contract code changed since it was approved (${s.pinnedHash.slice(0, 8)}… → ${s.codeHash.slice(0, 8)}…)`);
    }
  }
  if (s.exists && typeof s.ageDays === "number" && s.ageDays < NEW_ACCOUNT_DAYS) {
    add("warn", `created ${s.ageDays < 1 ? "less than a day" : `${Math.floor(s.ageDays)} days`} ago`);
  }
  if (s.exists && s.ageDays === null) add("info", "age not checked (no indexer)");

  const result = reasons.some((r) => r.level === "block") ? "block" : reasons.some((r) => r.level === "warn") ? "warn" : "allow";
  return { verdict: result, reasons };
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Reads what verdict() needs.
 * @param {string} account
 * @param {{ viewAccount: (id: string) => Promise<{code_hash: string}>, indexer: string|null,
 *           pins: Record<string, string>, blocklist: {account: string, reason: string, evidence: string}[],
 *           fetch?: typeof fetch, now?: number }} ctx
 */
export async function gather(account, ctx) {
  let exists = null;
  let codeHash = null;
  try {
    codeHash = (await ctx.viewAccount(account)).code_hash;
    exists = true;
  } catch (error) {
    const text = `${error?.message ?? ""} ${error?.type ?? ""} ${JSON.stringify(error?.cause ?? "")}`;
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(text)) exists = false;
  }

  let ageDays = null;
  if (exists && ctx.indexer) {
    try {
      const response = await (ctx.fetch ?? fetch)(`${ctx.indexer}/v1/account/${account}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const created = (await response.json())?.account?.[0]?.created?.block_timestamp;
      if (created) ageDays = ((ctx.now ?? Date.now()) - Number(created) / 1e6) / 86_400_000;
    } catch {
      ageDays = null;
    }
  }

  const listed = ctx.blocklist.find((entry) => entry.account === account) ?? null;
  return { account, exists, codeHash, pinnedHash: ctx.pins[account] ?? null, ageDays, listed };
}

export async function check(account, ctx) {
  const signals = await gather(account, ctx);
  return { ...verdict(signals), signals };
}

/** Records a contract's current code hash, so a later change blocks it. */
export function pin(pinsPath, pins, account, codeHash) {
  const next = { ...pins, [account]: codeHash };
  writeFileSync(pinsPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function describe(result) {
  const lines = result.reasons.map((r) => `${r.level}: ${r.text}`);
  return `${result.verdict.toUpperCase()}${lines.length ? ` (${lines.join("; ")})` : ""}`;
}

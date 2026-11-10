import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_CODE, check, describe, verdict } from "./check.mjs";

const base = { account: "kyawminthat.near", exists: true, codeHash: EMPTY_CODE, pinnedHash: null, ageDays: 400, listed: null };

test("an old account without a contract is allowed", () => {
  assert.equal(verdict(base).verdict, "allow");
});

test("an account that does not exist is blocked", () => {
  const r = verdict({ ...base, exists: false, ageDays: null });
  assert.equal(r.verdict, "block");
  assert.match(describe(r), /does not exist/);
});

test("an implicit account that does not exist yet is a warning, not a block", () => {
  const r = verdict({ ...base, account: "a".repeat(64), exists: false, ageDays: null });
  assert.equal(r.verdict, "warn");
});

test("an account that could not be read is a warning", () => {
  assert.equal(verdict({ ...base, exists: null, ageDays: null }).verdict, "warn");
});

test("a contract never paid before is a warning", () => {
  const r = verdict({ ...base, codeHash: "9S1DZHopohawkLoLnYGDqv1MAf5HjbJD1gSehkMQSRDV" });
  assert.equal(r.verdict, "warn");
  assert.match(describe(r), /contract not paid before/);
});

test("a contract whose code still matches its pin is allowed", () => {
  const hash = "9S1DZHopohawkLoLnYGDqv1MAf5HjbJD1gSehkMQSRDV";
  assert.equal(verdict({ ...base, codeHash: hash, pinnedHash: hash }).verdict, "allow");
});

test("a contract whose code changed since it was pinned is blocked", () => {
  const r = verdict({ ...base, codeHash: "9S1DZHopohawkLoLnYGDqv1MAf5HjbJD1gSehkMQSRDV", pinnedHash: "GxfinPGWZYkt9ZpHwVsoBKAkcTtNwCKQFrsEVWKdAMyX" });
  assert.equal(r.verdict, "block");
  assert.match(describe(r), /code changed/);
});

test("an account created days ago is a warning", () => {
  const r = verdict({ ...base, ageDays: 2.5 });
  assert.equal(r.verdict, "warn");
  assert.match(describe(r), /created 2 days ago/);
});

test("an account on the blocklist is blocked, with its evidence", () => {
  const r = verdict({ ...base, listed: { reason: "drained a vault", evidence: "https://example.org/report" } });
  assert.equal(r.verdict, "block");
  assert.match(describe(r), /drained a vault.*example\.org/);
});

test("block wins over warn", () => {
  const r = verdict({ ...base, ageDays: 1, listed: { reason: "scam", evidence: "x" } });
  assert.equal(r.verdict, "block");
});

test("no indexer leaves a note but does not change the verdict", () => {
  const r = verdict({ ...base, ageDays: null });
  assert.equal(r.verdict, "allow");
  assert.match(describe(r), /age not checked/);
});

test("check() reads existence, code and age through what it is given", async () => {
  const now = Date.UTC(2026, 10, 10);
  const viewAccount = async (id) => {
    if (id === "ghost.near") throw new Error("account ghost.near does not exist while viewing");
    return { code_hash: EMPTY_CODE };
  };
  const fetchAge = async () => ({ json: async () => ({ account: [{ created: { block_timestamp: (now - 3 * 86_400_000) * 1e6 } }] }) });
  const ctx = { viewAccount, indexer: "https://indexer.example", pins: {}, blocklist: [], fetch: fetchAge, now };
  assert.equal((await check("ghost.near", ctx)).verdict, "block");
  const young = await check("new.near", ctx);
  assert.equal(young.verdict, "warn");
  assert.equal(Math.round(young.signals.ageDays), 3);
});

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  evaluate,
  hashText,
  money,
  PRESETS,
  recipientOf,
  shortHash,
  STARTING,
  type Asset,
  type Decision,
  type Proposal,
  usdValue,
} from "@/lib/kyrona/engine";
import { selectSpent, treasuryUsd, useDesk } from "@/lib/kyrona/store";

export const Route = createFileRoute("/")({ component: Home });

type Tab = "desk" | "pay" | "rules" | "ledger";

function Home() {
  const [tab, setTab] = useState<Tab>("desk");
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Header tab={tab} onTab={setTab} />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16">
        {tab === "desk" && <Desk onPay={() => setTab("pay")} onRules={() => setTab("rules")} />}
        {tab === "pay" && <Pay />}
        {tab === "rules" && <Rules />}
        {tab === "ledger" && <Ledger />}
      </main>
    </div>
  );
}

function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const kill = useDesk((s) => s.rules.killSwitch);
  const setRules = useDesk((s) => s.setRules);
  const items: { id: Tab; label: string }[] = [
    { id: "desk", label: "Desk" },
    { id: "pay", label: "Pay" },
    { id: "rules", label: "Rules" },
    { id: "ledger", label: "Ledger" },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="font-display text-xl tracking-tight">Kyrona</div>
          <div className="hidden text-xs text-muted sm:block">Autonomous finance. Human-controlled.</div>
        </div>
        <nav className="ml-auto hidden gap-1 sm:flex">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              className={`rounded-full px-4 py-2 text-sm ${
                tab === item.id ? "bg-fg text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setRules({ killSwitch: !kill })}
          className={`rounded-full border px-3 py-2 text-xs font-medium ${
            kill ? "border-danger text-danger" : "border-line text-muted"
          }`}
        >
          {kill ? "Frozen" : "Live"}
        </button>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-3 sm:hidden">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm ${
              tab === item.id ? "bg-fg text-bg" : "bg-surface text-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function Desk({ onPay, onRules }: { onPay: () => void; onRules: () => void }) {
  const balances = useDesk((s) => s.balances);
  const rules = useDesk((s) => s.rules);
  const decisions = useDesk((s) => s.decisions);
  const spent = selectSpent(decisions);
  const usd = treasuryUsd(balances);
  const last = decisions[0];

  return (
    <div className="rise grid gap-6">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Treasury desk</p>
          <h1 className="mt-2 max-w-xl font-display text-4xl leading-[1.05] sm:text-5xl">
            Tell it what you want. Money moves only inside your rules.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
            Kyrona drafts a payment. A separate gate checks the recipient, the amount, and today’s budget
            before anything can settle.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onPay}
              className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink"
            >
              Run a payment
            </button>
            <button
              type="button"
              onClick={onRules}
              className="rounded-full border border-line px-5 py-3 text-sm text-fg"
            >
              Edit rules
            </button>
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Working principle</p>
          <p className="mt-3 font-display text-2xl leading-snug">
            Give the agent financial responsibility. Never unrestricted authority.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The agent cannot hold a key. It can only propose. Settlement is a separate step, and only if every
            check passes.
          </p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Treasury"
          value={`$${usd.toLocaleString()}`}
          note={`${balances.near} NEAR · $${balances.usdc.toLocaleString()} USDC`}
        />
        <Stat label="Spent today" value={`$${spent}`} note={`of $${rules.dailyCap} daily cap`} />
        <Stat
          label="Per payment"
          value={`$${rules.maxPerTx}`}
          note={rules.killSwitch ? "Kill switch is on" : `${rules.recipients.length} approved recipients`}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">What the judges should try</h2>
          <ol className="mt-4 space-y-3 text-sm text-muted">
            <li>1. Open Pay and choose “Pay Ava $150”. It is blocked. The limit is $50.</li>
            <li>2. Choose “Pay Ava $40”. Every check passes. Settle it.</li>
            <li>3. Open Rules and flip the kill switch. The next payment cannot move.</li>
          </ol>
        </div>
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">Latest decision</h2>
          {last ? (
            <DecisionSummary decision={last} />
          ) : (
            <p className="mt-4 text-sm text-muted">
              Nothing settled yet. The starting treasury is {STARTING.near} NEAR and $
              {STARTING.usdc.toLocaleString()} USDC.
            </p>
          )}
        </div>
      </section>

      <NearStrip />
    </div>
  );
}

function Pay() {
  const rules = useDesk((s) => s.rules);
  const decisions = useDesk((s) => s.decisions);
  const balances = useDesk((s) => s.balances);
  const record = useDesk((s) => s.record);
  const [presetId, setPresetId] = useState(PRESETS[1].id);
  const [phase, setPhase] = useState<"idle" | "reading" | "ready">("idle");
  const [active, setActive] = useState<Proposal | null>(null);
  const spent = selectSpent(decisions);

  const checks = useMemo(() => {
    if (!active) return [];
    const base = evaluate(rules, active, spent);
    const enough =
      active.asset === "USDC" ? balances.usdc >= active.amount : balances.near >= active.amount;
    return [
      ...base,
      {
        id: "funds",
        label: "Available balance",
        pass: enough,
        detail: enough
          ? "The treasury can cover this payment."
          : "Not enough of that asset is on the desk.",
      },
    ];
  }, [active, rules, spent, balances]);

  const authorized = checks.length > 0 && checks.every((c) => c.pass);
  const recipient = active ? recipientOf(rules, active) : null;

  function draft(id: string) {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
    setPresetId(id);
    setPhase("reading");
    setActive(null);
    window.setTimeout(() => {
      setActive({ ...preset.proposal, id: crypto.randomUUID() });
      setPhase("ready");
    }, 700);
  }

  function settle() {
    if (!active) return;
    const freshSpent = selectSpent(useDesk.getState().decisions);
    const freshBalances = useDesk.getState().balances;
    const freshRules = useDesk.getState().rules;
    const enough =
      active.asset === "USDC" ? freshBalances.usdc >= active.amount : freshBalances.near >= active.amount;
    const fresh = [
      ...evaluate(freshRules, active, freshSpent),
      {
        id: "funds",
        label: "Available balance",
        pass: enough,
        detail: enough ? "The treasury can cover this payment." : "Not enough of that asset is on the desk.",
      },
    ];
    const ok = fresh.every((c) => c.pass);
    const proposalHash = hashText(JSON.stringify(active));
    const decision: Decision = {
      id: crypto.randomUUID(),
      at: Date.now(),
      proposal: active,
      checks: fresh,
      status: ok ? "authorized" : "blocked",
      proposalHash,
      txHash: ok ? hashText(`tx:${active.id}:${Date.now()}`) : null,
      spentAfter: ok ? freshSpent + usdValue(active) : freshSpent,
    };
    record(decision);
    setPhase("idle");
    setActive(null);
  }

  return (
    <div className="rise grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Payment desk</p>
        <h1 className="mt-2 font-display text-4xl leading-tight">One goal. One verdict.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Start with the payment that should fail, then the one that should settle. Both use the same path.
        </p>
        <div className="mt-5 grid gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => draft(preset.id)}
              className={`rounded-card border px-4 py-4 text-left ${
                presetId === preset.id && phase !== "idle" ? "border-accent bg-raised" : "border-line bg-surface"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{preset.title}</span>
                <span className="text-xs text-muted">{preset.hint}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{preset.proposal.goal}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        {phase === "idle" && <EmptyGate />}
        {phase === "reading" && (
          <p className="font-display text-2xl">Reading the treasury and writing a proposal…</p>
        )}
        {phase === "ready" && active && (
          <div className="grid gap-5">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Structured proposal</p>
              <p className="mt-2 font-display text-3xl">{money(active.asset, active.amount)}</p>
              <p className="mt-1 text-sm text-muted">
                to {recipient ? `${recipient.label} · ${recipient.account}` : active.unknownAccount}
              </p>
              <p className="mt-2 text-sm">{active.memo}</p>
              <p className="mt-3 font-mono text-xs text-muted">
                proposal {shortHash(hashText(JSON.stringify(active)))} · agent has no signing key
              </p>
            </div>
            <ul className="grid gap-2">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start justify-between gap-3 rounded-2xl bg-raised px-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="text-xs text-muted">{check.detail}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${check.pass ? "text-ok" : "text-danger"}`}>
                    {check.pass ? "Pass" : "Block"}
                  </span>
                </li>
              ))}
            </ul>
            <div className={`rounded-2xl px-4 py-4 ${authorized ? "bg-accent text-accent-ink" : "bg-bg text-fg"}`}>
              <p className="font-display text-2xl">{authorized ? "Authorized" : "Rejected"}</p>
              <p className="mt-1 text-sm opacity-80">
                {authorized
                  ? "Every rule is satisfied. Settlement can proceed."
                  : "Payment stays locked. Nothing was signed."}
              </p>
              <button
                type="button"
                onClick={settle}
                className={`mt-4 rounded-full px-4 py-2 text-sm font-semibold ${
                  authorized ? "bg-accent-ink text-accent" : "bg-fg text-bg"
                }`}
              >
                {authorized ? "Settle via NEAR Intents" : "Record the block"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Rules() {
  const rules = useDesk((s) => s.rules);
  const setRules = useDesk((s) => s.setRules);
  const toggleAsset = useDesk((s) => s.toggleAsset);
  const reset = useDesk((s) => s.reset);

  return (
    <div className="rise grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Human authority</p>
        <h1 className="mt-2 font-display text-4xl">Rules the agent cannot edit.</h1>
        <div className="mt-6 grid gap-4">
          <Field label={`Per payment · $${rules.maxPerTx}`}>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={rules.maxPerTx}
              onChange={(e) => setRules({ maxPerTx: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label={`Daily budget · $${rules.dailyCap}`}>
            <input
              type="range"
              min={50}
              max={1000}
              step={50}
              value={rules.dailyCap}
              onChange={(e) => setRules({ dailyCap: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label="Assets">
            <div className="flex gap-2">
              {(["USDC", "NEAR"] as Asset[]).map((asset) => {
                const on = rules.allowedAssets.includes(asset);
                return (
                  <button
                    key={asset}
                    type="button"
                    onClick={() => toggleAsset(asset)}
                    className={`rounded-full px-4 py-2 text-sm ${on ? "bg-fg text-bg" : "border border-line text-muted"}`}
                  >
                    {asset}
                  </button>
                );
              })}
            </div>
          </Field>
          <button
            type="button"
            onClick={() => setRules({ killSwitch: !rules.killSwitch })}
            className={`rounded-card border px-4 py-4 text-left ${rules.killSwitch ? "border-danger" : "border-line"}`}
          >
            <p className="font-medium">{rules.killSwitch ? "Kill switch is on" : "Kill switch is off"}</p>
            <p className="mt-1 text-sm text-muted">
              {rules.killSwitch
                ? "Every proposal is blocked until you turn this off."
                : "Turn it on to freeze spending immediately."}
            </p>
          </button>
        </div>
      </section>
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-medium">Approved recipients</h2>
        <ul className="mt-4 grid gap-3">
          {rules.recipients.map((person) => (
            <li key={person.id} className="rounded-2xl bg-raised px-4 py-3">
              <p className="font-medium">{person.label}</p>
              <p className="font-mono text-xs text-muted">{person.account}</p>
              <p className="mt-1 text-xs text-muted">{person.role}</p>
            </li>
          ))}
        </ul>
        <button type="button" onClick={reset} className="mt-5 text-sm text-muted underline">
          Reset desk to the demo treasury
        </button>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          In production these rules live in a NEAR contract and a function-call key that can only submit an intent
          the contract already allowed. This preview evaluates the same checks in the browser so a judge can run both
          outcomes without gas.
        </p>
      </section>
    </div>
  );
}

function Ledger() {
  const decisions = useDesk((s) => s.decisions);
  return (
    <div className="rise">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Evidence</p>
      <h1 className="mt-2 font-display text-4xl">Every verdict stays on the desk.</h1>
      {decisions.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No decisions yet. Run the $150 block and the $40 settlement.</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="rounded-card border border-line bg-surface p-4">
              <DecisionSummary decision={decision} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisionSummary({ decision }: { decision: Decision }) {
  const recipients = useDesk((s) => s.rules.recipients);
  const who = recipients.find((r) => r.id === decision.proposal.recipientId);
  const failed = decision.checks.find((c) => !c.pass);
  return (
    <div className="mt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {money(decision.proposal.asset, decision.proposal.amount)} · {who?.label ?? decision.proposal.unknownAccount}
          </p>
          <p className="text-xs text-muted">{new Date(decision.at).toLocaleString()}</p>
        </div>
        <span className={`text-xs font-medium ${decision.status === "authorized" ? "text-ok" : "text-danger"}`}>
          {decision.status === "authorized" ? "Settled" : "Blocked"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {decision.status === "authorized"
          ? `Intent ${decision.txHash ? shortHash(decision.txHash) : ""}. Proposal ${shortHash(decision.proposalHash)}.`
          : failed?.detail}
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function EmptyGate() {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-muted">Policy gate</p>
      <p className="mt-3 font-display text-3xl leading-tight">Waiting for a proposal.</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Pick a payment on the left. Kyrona will write a structured proposal, then this gate accepts or rejects it. A
        rejection never produces a transaction.
      </p>
    </div>
  );
}

function NearStrip() {
  const items = [
    ["Proposal only", "The agent writes intent fields. It never receives a full-access key."],
    ["Policy before sign", "Recipient, asset, per-payment cap, daily budget, and kill switch are checked first."],
    ["NEAR Intents", "An authorized payment is the only path that can settle across chains."],
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {items.map(([title, body]) => (
        <div key={title} className="rounded-card border border-line px-4 py-4">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        </div>
      ))}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 rounded-card border border-line bg-surface px-4 py-4">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  evaluate,
  hashText,
  money,
  shortHash,
  spentToday,
  type Asset,
  type Decision,
  type Proposal,
} from "@/lib/kyrona/engine";
import { useDesk } from "@/lib/kyrona/store";

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
          <div className="hidden text-xs text-muted sm:block">Check the payment before you send it.</div>
        </div>
        <nav className="ml-auto hidden gap-1 sm:flex">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setRules({ killSwitch: !kill })}
          className={`rounded-full border px-3 py-2 text-xs font-medium ${kill ? "border-danger text-danger" : "border-line text-muted"}`}
        >
          {kill ? "Locked" : "Open"}
        </button>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-3 sm:hidden">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-fg text-bg" : "bg-surface text-muted"}`}
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
  const setBalances = useDesk((s) => s.setBalances);
  const rules = useDesk((s) => s.rules);
  const decisions = useDesk((s) => s.decisions);
  const usdcSpent = spentToday(decisions, "USDC");
  const nearSpent = spentToday(decisions, "NEAR");
  const last = decisions[0];
  const [usdc, setUsdc] = useState(String(balances.usdc || ""));
  const [near, setNear] = useState(String(balances.near || ""));

  function saveBalances() {
    setBalances({
      usdc: Math.max(0, Number(usdc) || 0),
      near: Math.max(0, Number(near) || 0),
    });
  }

  return (
    <div className="rise grid gap-6">
      <section className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Spending desk</p>
        <h1 className="mt-2 font-display text-4xl leading-[1.05] sm:text-5xl">
          Stop the wrong payment before the money leaves.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Put in what you hold, who you pay, and the limits. Kyrona refuses a payment that breaks those limits.
          You only send from your wallet after it says yes.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onPay} className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink">
            New payment
          </button>
          <button type="button" onClick={onRules} className="rounded-full border border-line px-5 py-3 text-sm">
            Add someone you pay
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">What you hold</p>
          <label className="mt-3 block text-sm">
            USDC
            <input
              inputMode="decimal"
              value={usdc}
              onChange={(e) => setUsdc(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              placeholder="0"
            />
          </label>
          <label className="mt-3 block text-sm">
            NEAR
            <input
              inputMode="decimal"
              value={near}
              onChange={(e) => setNear(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3"
              placeholder="0"
            />
          </label>
          <button type="button" onClick={saveBalances} className="mt-4 rounded-full bg-fg px-4 py-2 text-sm text-bg">
            Save balances
          </button>
          <p className="mt-3 text-xs text-muted">Saved: ${balances.usdc.toLocaleString()} USDC · {balances.near} NEAR</p>
        </div>
        <div className="grid gap-3">
          <Stat label="USDC today" value={`$${usdcSpent}`} note={`of $${rules.dailyUsdc} · $${rules.maxUsdc} per payment`} />
          <Stat label="NEAR today" value={`${nearSpent}`} note={`of ${rules.dailyNear} · ${rules.maxNear} per payment`} />
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-medium">Last decision</h2>
        {last ? (
          <DecisionSummary decision={last} />
        ) : (
          <p className="mt-3 text-sm text-muted">
            {rules.recipients.length === 0
              ? "Add the people you actually pay, then check a payment against the limits."
              : "No payments yet. The next one will be checked before you send it."}
          </p>
        )}
      </section>
    </div>
  );
}

function Pay() {
  const rules = useDesk((s) => s.rules);
  const decisions = useDesk((s) => s.decisions);
  const balances = useDesk((s) => s.balances);
  const record = useDesk((s) => s.record);
  const [recipientId, setRecipientId] = useState(rules.recipients[0]?.id ?? "");
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [active, setActive] = useState<Proposal | null>(null);
  const [error, setError] = useState("");

  const spent = active ? spentToday(decisions, active.asset) : 0;
  const checks = useMemo(() => {
    if (!active) return [];
    const enough = active.asset === "USDC" ? balances.usdc >= active.amount : balances.near >= active.amount;
    return [
      ...evaluate(rules, active, spent),
      {
        id: "funds",
        label: "Balance",
        pass: enough,
        detail: enough ? "You have enough on the desk." : "The desk balance is lower than this payment. Update what you hold, or lower the amount.",
      },
    ];
  }, [active, rules, spent, balances]);
  const authorized = checks.length > 0 && checks.every((c) => c.pass);

  function review() {
    const value = Number(amount);
    if (!recipientId) {
      setError("Add a recipient under Rules first.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError("");
    const person = rules.recipients.find((r) => r.id === recipientId);
    setActive({
      id: crypto.randomUUID(),
      goal: memo || `Pay ${person?.label ?? "recipient"}`,
      asset,
      amount: value,
      recipientId,
      memo: memo || "Payment",
    });
  }

  function commit() {
    if (!active) return;
    const freshRules = useDesk.getState().rules;
    const freshBalances = useDesk.getState().balances;
    const freshSpent = spentToday(useDesk.getState().decisions, active.asset);
    const enough = active.asset === "USDC" ? freshBalances.usdc >= active.amount : freshBalances.near >= active.amount;
    const fresh = [
      ...evaluate(freshRules, active, freshSpent),
      {
        id: "funds",
        label: "Balance",
        pass: enough,
        detail: enough ? "You have enough on the desk." : "Not enough on the desk.",
      },
    ];
    const ok = fresh.every((c) => c.pass);
    record({
      id: crypto.randomUUID(),
      at: Date.now(),
      proposal: active,
      checks: fresh,
      status: ok ? "authorized" : "blocked",
      proposalHash: hashText(JSON.stringify(active)),
      txHash: null,
      spentAfter: ok ? freshSpent + active.amount : freshSpent,
    });
    setActive(null);
    setAmount("");
    setMemo("");
  }

  return (
    <div className="rise grid gap-6 lg:grid-cols-2">
      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Payment</p>
        <h1 className="mt-2 font-display text-4xl">Check it, then send it.</h1>
        <div className="mt-5 grid gap-3">
          <label className="grid gap-1 text-sm">
            Who
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-3"
            >
              {rules.recipients.length === 0 && <option value="">No one yet</option>}
              {rules.recipients.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label} · {person.account}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {(["USDC", "NEAR"] as Asset[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setAsset(item)}
                className={`rounded-full px-4 py-2 text-sm ${asset === item ? "bg-fg text-bg" : "border border-line text-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="grid gap-1 text-sm">
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-3"
              placeholder={asset === "USDC" ? "40" : "2"}
            />
          </label>
          <label className="grid gap-1 text-sm">
            What it’s for
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-3"
              placeholder="Invoice, rent, contractor"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="button" onClick={review} className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink">
            Check against my rules
          </button>
        </div>
      </section>
      <section className="rounded-card border border-line bg-surface p-5">
        {!active && (
          <div>
            <p className="font-display text-3xl">Nothing checked yet.</p>
            <p className="mt-3 text-sm text-muted">
              Fill in the payment. Kyrona will say yes or no. A no does not change your balance.
            </p>
          </div>
        )}
        {active && (
          <div className="grid gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Result</p>
              <p className="mt-2 font-display text-3xl">{money(active.asset, active.amount)}</p>
              <p className="mt-1 text-sm text-muted">{active.memo}</p>
            </div>
            <ul className="grid gap-2">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start justify-between gap-3 rounded-2xl bg-raised px-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="text-xs text-muted">{check.detail}</p>
                  </div>
                  <span className={`text-xs font-medium ${check.pass ? "text-ok" : "text-danger"}`}>
                    {check.pass ? "Pass" : "Stop"}
                  </span>
                </li>
              ))}
            </ul>
            <div className={`rounded-2xl px-4 py-4 ${authorized ? "bg-accent text-accent-ink" : "bg-bg"}`}>
              <p className="font-display text-2xl">{authorized ? "Safe to send" : "Do not send"}</p>
              <p className="mt-1 text-sm opacity-80">
                {authorized
                  ? "Send it from your wallet, then record it here so today’s limit stays accurate."
                  : "Fix the amount, the person, or the lock. Nothing was deducted."}
              </p>
              <button
                type="button"
                onClick={commit}
                className={`mt-4 rounded-full px-4 py-2 text-sm font-semibold ${authorized ? "bg-accent-ink text-accent" : "bg-fg text-bg"}`}
              >
                {authorized ? "I sent it — update my desk" : "Save this stop"}
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
  const addRecipient = useDesk((s) => s.addRecipient);
  const removeRecipient = useDesk((s) => s.removeRecipient);
  const reset = useDesk((s) => s.reset);
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState("");
  const [role, setRole] = useState("");
  const [formError, setFormError] = useState("");

  function addPerson() {
    if (label.trim().length < 2 || account.trim().length < 2) {
      setFormError("Name and account are both required.");
      return;
    }
    addRecipient({ label: label.trim(), account: account.trim(), role: role.trim() || "Payee" });
    setLabel("");
    setAccount("");
    setRole("");
    setFormError("");
  }

  return (
    <div className="rise grid gap-6 lg:grid-cols-2">
      <section>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Limits</p>
        <h1 className="mt-2 font-display text-4xl">Your limits, not a suggestion.</h1>
        <div className="mt-6 grid gap-4">
          <NumberField label="Max USDC per payment" value={rules.maxUsdc} onChange={(n) => setRules({ maxUsdc: n })} />
          <NumberField label="USDC per day" value={rules.dailyUsdc} onChange={(n) => setRules({ dailyUsdc: n })} />
          <NumberField label="Max NEAR per payment" value={rules.maxNear} onChange={(n) => setRules({ maxNear: n })} />
          <NumberField label="NEAR per day" value={rules.dailyNear} onChange={(n) => setRules({ dailyNear: n })} />
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
                  {on ? `${asset} on` : `${asset} off`}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setRules({ killSwitch: !rules.killSwitch })}
            className={`rounded-card border px-4 py-4 text-left ${rules.killSwitch ? "border-danger" : "border-line"}`}
          >
            <p className="font-medium">{rules.killSwitch ? "Spending is locked" : "Spending is open"}</p>
            <p className="mt-1 text-sm text-muted">Lock it when you want every payment to stop, including ones that fit the caps.</p>
          </button>
        </div>
      </section>
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-medium">People you pay</h2>
        <div className="mt-4 grid gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="rounded-xl border border-line bg-bg px-3 py-3 text-sm" />
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account or address" className="rounded-xl border border-line bg-bg px-3 py-3 text-sm" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Why you pay them" className="rounded-xl border border-line bg-bg px-3 py-3 text-sm" />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <button type="button" onClick={addPerson} className="rounded-full bg-fg px-4 py-2 text-sm text-bg">
            Add
          </button>
        </div>
        <ul className="mt-4 grid gap-2">
          {rules.recipients.length === 0 && <li className="text-sm text-muted">Nobody yet. Payments to unknown accounts are stopped.</li>}
          {rules.recipients.map((person) => (
            <li key={person.id} className="flex items-start justify-between gap-3 rounded-2xl bg-raised px-3 py-3">
              <div>
                <p className="text-sm font-medium">{person.label}</p>
                <p className="font-mono text-xs text-muted">{person.account}</p>
                <p className="text-xs text-muted">{person.role}</p>
              </div>
              <button type="button" onClick={() => removeRecipient(person.id)} className="text-xs text-muted">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={reset} className="mt-5 text-sm text-muted underline">
          Clear the desk
        </button>
      </section>
    </div>
  );
}

function Ledger() {
  const decisions = useDesk((s) => s.decisions);
  return (
    <div className="rise">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl">What you approved and what you stopped.</h1>
      {decisions.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Empty. A checked payment will show up here, whether you sent it or stopped it.</p>
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
    <div className="mt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {money(decision.proposal.asset, decision.proposal.amount)} · {who?.label ?? "Removed recipient"}
          </p>
          <p className="text-xs text-muted">{new Date(decision.at).toLocaleString()}</p>
        </div>
        <span className={`text-xs font-medium ${decision.status === "authorized" ? "text-ok" : "text-danger"}`}>
          {decision.status === "authorized" ? "Sent" : "Stopped"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {decision.status === "authorized" ? decision.proposal.memo : failed?.detail} · {shortHash(decision.proposalHash)}
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="grid gap-2 text-sm">
      <span>{label}</span>
      <input
        inputMode="decimal"
        defaultValue={value}
        key={`${label}-${value}`}
        onBlur={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="rounded-xl border border-line bg-surface px-3 py-3"
      />
    </label>
  );
}

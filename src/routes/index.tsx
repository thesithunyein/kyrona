import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { readBalances, isNearAccount } from "@/lib/kyrona/chain";
import { contractLive, nearLabel, readChainRules } from "@/lib/kyrona/policy";
import { useDesk } from "@/lib/kyrona/store";
import { openAccount } from "@/lib/kyrona/session";
import { addLimitedPayKey, connectWallet, createVendor, disconnectWallet, fundRules, limitedKeyStored, payThroughWallet, payWithLimitedKey, putRulesOnChain, putRulesWithKey, restoreWallet, runAgent, saveDeskOnAccount, sendOnNear, showKeyLimits, vendorAccount } from "@/lib/kyrona/wallet";

export const Route = createFileRoute("/")({ component: Home });

type Tab = "desk" | "pay" | "rules" | "ledger";

function Home() {
  const [tab, setTab] = useState<Tab>("desk");
  const [launch, setLaunch] = useState<"show" | "leave" | "gone">("show");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduce ? 200 : 900;
    const fade = reduce ? 0 : 420;
    const leave = window.setTimeout(() => setLaunch("leave"), hold);
    const gone = window.setTimeout(() => setLaunch("gone"), hold + fade);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, []);

  useEffect(() => {
    let live = true;
    restoreWallet()
      .then(async (id) => {
        if (!live || !id) return;
        await openAccount(id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      {launch !== "gone" && <Launch leaving={launch === "leave"} />}
      <Header tab={tab} onTab={setTab} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-8">
        {tab === "desk" && <Desk onPay={() => setTab("pay")} onRules={() => setTab("rules")} />}
        {tab === "pay" && <Pay />}
        {tab === "rules" && <Rules />}
        {tab === "ledger" && <Ledger />}
      </main>
      <nav className="tabbar">
        {(
          [
            ["desk", "Desk"],
            ["pay", "Pay"],
            ["rules", "Rules"],
            ["ledger", "Ledger"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? "text-fg" : "text-muted"}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Launch({ leaving }: { leaving: boolean }) {
  return (
    <div className={`launch ${leaving ? "launch-leave" : ""}`} role="status" aria-live="polite">
      <div className="grid justify-items-center gap-5">
        <Mark className="h-20 w-auto" />
        <div className="text-center">
          <p className="font-display text-2xl tracking-tight">Kyrona</p>
          <p className="mt-1 text-sm text-muted">Opening the desk</p>
        </div>
        <div className="launch-track" aria-hidden="true">
          <div className="launch-bar" />
        </div>
      </div>
    </div>
  );
}

function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const kill = useDesk((s) => s.rules.killSwitch);
  const setRules = useDesk((s) => s.setRules);
  const accountId = useDesk((s) => s.accountId);
  const setAccount = useDesk((s) => s.setAccount);
  const [busy, setBusy] = useState(false);
  const [walletNote, setWalletNote] = useState("");
  const items: { id: Tab; label: string }[] = [
    { id: "desk", label: "Desk" },
    { id: "pay", label: "Pay" },
    { id: "rules", label: "Rules" },
    { id: "ledger", label: "Ledger" },
  ];

  async function onWallet() {
    setBusy(true);
    setWalletNote("");
    try {
      if (accountId) {
        await disconnectWallet();
        setAccount(null);
        return;
      }
      const id = await connectWallet();
      await openAccount(id);
    } catch (error) {
      setWalletNote(error instanceof Error ? error.message : "The wallet did not open.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Mark className="h-9 w-auto" />
          <div className="min-w-0">
            <div className="text-sm font-medium tracking-tight">Kyrona</div>
            <div className="hidden text-xs text-muted sm:block">Before you send</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onWallet}
          disabled={busy}
          className="ml-auto max-w-36 truncate rounded-full bg-surface px-3 py-2 text-xs sm:ml-0"
        >
          {busy ? "Opening" : accountId ? accountId : "Connect"}
        </button>
        {walletNote ? <p className="w-full text-xs text-danger">{walletNote}</p> : null}
        <nav className="ml-auto hidden rounded-full bg-surface p-1 sm:flex">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm ${tab === item.id ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setRules({ killSwitch: !kill })}
          className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-medium ${
            kill ? "bg-danger/15 text-danger" : "bg-raised text-muted"
          }`}
        >
          <span className={`size-1.5 rounded-full ${kill ? "bg-danger" : "bg-ok"}`} />
          {kill ? "Locked" : "Open"}
        </button>
      </div>
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
  const accountId = useDesk((s) => s.accountId);
  const [usdc, setUsdc] = useState(String(balances.usdc || ""));
  const [near, setNear] = useState(String(balances.near || ""));
  const [chainError, setChainError] = useState("");

  useEffect(() => {
    if (!accountId) return;
    setUsdc(String(balances.usdc || ""));
    setNear(String(balances.near || ""));
  }, [accountId, balances.usdc, balances.near]);

  async function refreshChain() {
    if (!accountId) return;
    setChainError("");
    try {
      setBalances(await readBalances(accountId));
    } catch (error) {
      setChainError(error instanceof Error ? error.message : "Could not read the account.");
    }
  }

  function saveBalances() {
    setBalances({
      usdc: Math.max(0, Number(usdc) || 0),
      near: Math.max(0, Number(near) || 0),
    });
  }

  return (
    <div className="rise grid gap-8">
      <section className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="kicker">Desk</p>
          <h1 className="display mt-3 text-4xl sm:text-5xl">Pay only what you meant.</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted">People, limits, then a yes or no.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={onPay} className="btn btn-primary">
              New payment
            </button>
            <button type="button" onClick={onRules} className="btn btn-quiet">
              Add someone you pay
            </button>
          </div>
          <ul className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            <Feature label="Known payees">
              <IconPeople />
            </Feature>
            <Feature label="Hard limits">
              <IconLimit />
            </Feature>
            <Feature label="Yes or no">
              <IconGate />
            </Feature>
          </ul>
        </div>
        <Vault open={!rules.killSwitch} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="card p-5">
          <p className="kicker">{accountId ? "On chain" : "Balances"}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm text-muted">
              USDC
              <input inputMode="decimal" value={usdc} onChange={(e) => setUsdc(e.target.value)} readOnly={Boolean(accountId)} className="field nums" placeholder="0" />
            </label>
            <label className="grid gap-1.5 text-sm text-muted">
              NEAR
              <input inputMode="decimal" value={near} onChange={(e) => setNear(e.target.value)} readOnly={Boolean(accountId)} className="field nums" placeholder="0" />
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="nums text-xs text-muted">
              {accountId ? accountId : `On file · $${balances.usdc.toLocaleString()} USDC · ${balances.near} NEAR`}
            </p>
            {accountId ? (
              <button type="button" onClick={refreshChain} className="btn btn-ink">
                Refresh
              </button>
            ) : (
              <button type="button" onClick={saveBalances} className="btn btn-ink">
                Save balances
              </button>
            )}
          </div>
          {chainError && <p className="mt-3 text-sm text-danger">{chainError}</p>}
        </div>
        <div className="grid gap-4">
          <Stat label="USDC today" value={`$${usdcSpent}`} used={usdcSpent} cap={rules.dailyUsdc} note={`$${rules.maxUsdc} per payment`} />
          <Stat label="NEAR today" value={`${nearSpent}`} used={nearSpent} cap={rules.dailyNear} note={`${rules.maxNear} per payment`} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-medium">Last decision</h2>
        {last ? (
          <DecisionSummary decision={last} />
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {rules.recipients.length === 0
              ? "Add who you pay first."
              : "No payments yet."}
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
  const accountId = useDesk((s) => s.accountId);
  const setBalances = useDesk((s) => s.setBalances);
  const [busy, setBusy] = useState(false);
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

  async function commit() {
    if (!active || busy) return;
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
    if (!ok) {
      record({
        id: crypto.randomUUID(),
        at: Date.now(),
        proposal: active,
        checks: fresh,
        status: "blocked",
        proposalHash: hashText(JSON.stringify(active)),
        txHash: null,
        spentAfter: freshSpent,
      });
      setActive(null);
      return;
    }
    const signer = useDesk.getState().accountId;
    const person = freshRules.recipients.find((item) => item.id === active.recipientId);
    if (!signer) {
      setError("Connect a NEAR wallet before sending.");
      return;
    }
    if (!person || !isNearAccount(person.account)) {
      setError("The recipient must be a NEAR account, such as name.near.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const onChain = active.asset === "NEAR" && (await contractLive(signer));
      const txHash = !onChain
        ? await sendOnNear({
            signerId: signer,
            receiverId: person.account,
            asset: active.asset,
            amount: String(active.amount),
            memo: active.memo,
          })
        : limitedKeyStored(signer)
          ? await payWithLimitedKey(signer, person.account, String(active.amount))
          : await payThroughWallet(signer, person.account, String(active.amount));
      record({
        id: crypto.randomUUID(),
        at: Date.now(),
        proposal: active,
        checks: fresh,
        status: "authorized",
        proposalHash: hashText(JSON.stringify(active)),
        txHash,
        spentAfter: freshSpent + active.amount,
      });
      setBalances(await readBalances(signer));
      setActive(null);
      setAmount("");
      setMemo("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "The wallet did not send it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise grid items-start gap-6 lg:grid-cols-2">
      <section className="card p-5">
        <p className="kicker">Payment</p>
        <h1 className="display mt-3 text-3xl">Check, then send.</h1>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm text-muted">
            Who
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} className="field">
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
                className={`chip ${asset === item ? "bg-fg text-bg" : "btn-quiet"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm text-muted">
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="field nums"
              placeholder={asset === "USDC" ? "40" : "2"}
            />
          </label>
          <label className="grid gap-1.5 text-sm text-muted">
            What it’s for
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className="field" placeholder="Invoice, rent, contractor" />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="button" onClick={review} className="btn btn-primary">
            Check against my rules
          </button>
        </div>
      </section>
      <section className="card p-5">
        {!active && (
          <div>
            <p className="mt-3 font-display text-3xl leading-tight">Waiting.</p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
              Enter the payment. A no does not change the balance.
            </p>
          </div>
        )}
        {active && (
          <div className="grid gap-4">
            <div>
              <p className="kicker">Result</p>
              <p className="display nums mt-2 text-4xl">{money(active.asset, active.amount)}</p>
              <p className="mt-1 text-sm text-muted">{active.memo}</p>
            </div>
            <ul className="grid gap-2">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start justify-between gap-3 rounded-xl bg-raised px-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="text-xs text-muted">{check.detail}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${check.pass ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}>
                    {check.pass ? "Pass" : "Stop"}
                  </span>
                </li>
              ))}
            </ul>
            <div className={`rounded-xl px-4 py-4 ${authorized ? "bg-accent text-accent-ink" : "bg-bg"}`}>
              <p className="display text-2xl">{authorized ? "Safe to send" : "Do not send"}</p>
              <p className="mt-1 text-sm opacity-80">
                {authorized
                  ? accountId
                    ? "Your wallet will ask you to sign. The transaction is the record."
                    : "Connect a wallet. Nothing is sent until you sign."
                  : "Fix the amount, the person, or the lock. Nothing was deducted."}
              </p>
              <button
                type="button"
                onClick={commit}
                className={`btn mt-4 ${authorized ? "bg-accent-ink text-accent" : "btn-ink"}`}
              >
                {busy ? "Waiting for the wallet" : authorized ? (accountId ? "Send on NEAR" : "Connect a wallet to send") : "Save this stop"}
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
    <div className="rise grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <p className="kicker">Limits</p>
        <h1 className="display mt-3 text-4xl">The limits.</h1>
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
                className={`chip ${on ? "bg-fg text-bg" : "btn-quiet"}`}
                >
                  {on ? `${asset} on` : `${asset} off`}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setRules({ killSwitch: !rules.killSwitch })}
            className={`card px-4 py-4 text-left ${rules.killSwitch ? "shadow-[inset_0_0_0_1px_var(--color-danger)]" : ""}`}
          >
            <p className="font-medium">{rules.killSwitch ? "Spending is locked" : "Spending is open"}</p>
            <p className="mt-1 text-sm text-muted">Lock it when you want every payment to stop, including ones that fit the caps.</p>
          </button>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="text-sm font-medium">People you pay</h2>
        <div className="mt-4 grid gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="field" />
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account or address" className="field" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Why you pay them" className="field" />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <button type="button" onClick={addPerson} className="btn btn-ink">
            Add
          </button>
        </div>
        <ul className="mt-4 grid gap-2">
          {rules.recipients.length === 0 && <li className="text-sm text-muted">Nobody yet. Payments to unknown accounts are stopped.</li>}
          {rules.recipients.map((person) => (
            <li key={person.id} className="flex items-start justify-between gap-3 rounded-xl bg-raised px-3 py-3">
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
        <DeskCode />
        <SaveOnAccount />
      </section>
      </div>
      <OnChain />
    </div>
  );
}

function Ledger() {
  const decisions = useDesk((s) => s.decisions);
  return (
    <div className="rise">
      <p className="kicker">Ledger</p>
      <h1 className="display mt-3 max-w-xl text-4xl">The record.</h1>
      {decisions.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="card p-4">
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
          <p className="nums font-medium">
            {money(decision.proposal.asset, decision.proposal.amount)} · {who?.label ?? "Removed recipient"}
          </p>
          <p className="text-xs text-muted">{new Date(decision.at).toLocaleString()}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${decision.status === "authorized" ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}>
          {decision.status === "authorized" ? "Sent" : "Stopped"}
        </span>
      </div>
        {decision.txHash ? (
          <a className="mt-2 block text-sm text-fg underline" href={`https://nearblocks.io/txns/${decision.txHash}`} target="_blank" rel="noreferrer">
            {shortHash(decision.txHash)}
          </a>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {decision.status === "authorized" ? decision.proposal.memo : failed?.detail} · {shortHash(decision.proposalHash)}
          </p>
        )}
    </div>
  );
}

function Stat({ label, value, used, cap, note }: { label: string; value: string; used: number; cap: number; note: string }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="card px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="kicker">{label}</p>
        <p className="nums text-xs text-muted">{pct}%</p>
      </div>
      <p className="display nums mt-2 text-3xl">{value}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">of {cap} · {note}</p>
    </div>
  );
}

function Feature({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="grid gap-2">
      <span className="text-fg">{children}</span>
      <span className="text-xs text-muted">{label}</span>
    </li>
  );
}

function IconPeople() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <circle cx="9" cy="8" r="2.2" />
      <path d="M4.8 17.5c.6-2.2 2.3-3.3 4.2-3.3s3.6 1.1 4.2 3.3" />
      <circle cx="16" cy="9" r="1.7" />
      <path d="M15 14.4c1.5.2 2.8 1.1 3.4 2.6" />
    </svg>
  );
}

function IconLimit() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <path d="M5 17V7M10 17V10M15 17v-4M20 17V5" />
    </svg>
  );
}

function IconGate() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SaveOnAccount() {
  const accountId = useDesk((s) => s.accountId);
  const rules = useDesk((s) => s.rules);
  const decisions = useDesk((s) => s.decisions);
  const savedAt = useDesk((s) => s.deskSavedAt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!accountId) {
      setNote("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const snapshot = { v: 1 as const, savedAt: savedAt || Date.now(), rules, decisions: decisions.slice(0, 20) };
      const hash = await saveDeskOnAccount(accountId, snapshot);
      setNote(`Saved on ${accountId}. ${hash.slice(0, 8)}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-2">
      <p className="text-sm font-medium">Keep this desk on your account</p>
      <p className="text-xs text-muted">One signature. The same wallet loads these rules and the ledger on another phone.</p>
      <button type="button" onClick={save} disabled={busy} className="btn btn-ink">
        {busy ? "Waiting for the wallet" : "Save to my account"}
      </button>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function OnChain() {
  const accountId = useDesk((s) => s.accountId);
  const rules = useDesk((s) => s.rules);
  const [live, setLive] = useState<boolean | null>(null);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState("");
  const [seen, setSeen] = useState(0);
  const addRecipient = useDesk((s) => s.addRecipient);

  useEffect(() => {
    if (!accountId) return;
    let current = true;
    contractLive(accountId)
      .then((yes) => current && setLive(yes))
      .catch((error: unknown) => current && setNote(error instanceof Error ? error.message : "Could not reach the chain."));
    setHeld(limitedKeyStored(accountId));
    return () => {
      current = false;
    };
  }, [accountId]);

  async function run(task: () => Promise<unknown>, done: string) {
    if (!accountId) {
      setNote("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const result = await task();
      setNote(done || (typeof result === "string" ? result : "Done."));
      setLive(await contractLive(accountId).catch(() => live));
      setHeld(limitedKeyStored(accountId));
      setSeen((value) => value + 1);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The wallet did not approve it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <p className="kicker">On the account</p>
      <h2 className="display mt-3 text-3xl">{accountId ? `rules.${accountId}` : "A separate rules account."}</h2>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        {live === true
          ? "A NEAR payment has to pass the list, the lock, and the caps on rules." + (accountId ? accountId : "your account") + ". The limited key can call pay, and nothing else."
          : live === false
            ? "The wallet link cannot carry a contract this size. Paste the Meteor key below. It is used once in this browser and is not saved. This creates rules." +
              (accountId ?? "yourname.near") +
              ". About 0.79 NEAR moves there. 0.74 stays locked for the code. 0.05 can be paid out."
            : "Checking the account."}
      </p>
      {accountId && live && <ChainSummary accountId={accountId} seen={seen} />}
      <div className="mt-5 grid gap-2">
        {live === false && (
          <>
            <input
              type="password"
              value={secret}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="ed25519: private key"
              className="field"
            />
            <button
              type="button"
              disabled={busy || secret.trim().length < 20}
              className="btn btn-ink"
              onClick={() =>
                run(async () => {
                  const hash = await putRulesWithKey(accountId!, rules, secret);
                  setSecret("");
                  return hash;
                }, "Rules are on the account.")
              }
            >
              {busy ? "Sending" : "Put the rules on chain"}
            </button>
          </>
        )}
        {live === true && (
          <button type="button" disabled={busy} className="btn btn-ink" onClick={() => run(() => putRulesOnChain(accountId!, rules), "Rules updated.")}>
            {busy ? "Waiting for the wallet" : "Update the rules"}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !live} className="btn btn-quiet" onClick={() => run(() => addLimitedPayKey(accountId!), held ? "Another limited key was added." : "This browser holds the limited key.")}>
          {held ? "Limited key is here" : "Add a limited key"}
        </button>
        <button
          type="button"
          disabled={busy || !held}
          className="btn btn-quiet"
          onClick={() =>
            run(async () => {
              const result = await showKeyLimits(accountId!);
              return `List check: ${result.pay} Direct transfer: ${result.transfer}`;
            }, "")
          }
        >
          Try to break it
        </button>
      </div>
      {live === true && accountId && (
        <div className="mt-5 grid gap-2">
          <p className="text-sm font-medium">The three proofs</p>
          <button
            type="button"
            disabled={busy}
            className="btn btn-quiet"
            onClick={() =>
              run(async () => {
                const hash = await createVendor(accountId);
                const vendor = vendorAccount(accountId);
                if (!useDesk.getState().rules.recipients.some((person) => person.account === vendor)) {
                  addRecipient({ label: "Vendor", account: vendor, role: "The other account" });
                }
                return hash;
              }, `${vendorAccount(accountId)} is on the list.`)
            }
          >
            {busy ? "Waiting for the wallet" : "1. Create the other account"}
          </button>
          <button type="button" disabled={busy} className="btn btn-quiet" onClick={() => run(() => fundRules(accountId), "0.2 NEAR was added. That is what this account can spare.")}>
            {busy ? "Waiting for the wallet" : "2. Add 0.2 NEAR"}
          </button>
          <button type="button" disabled={busy || !held} className="btn btn-ink" onClick={() => run(() => runAgent(accountId), "")}>
            {busy ? "The agent is paying" : "3. Run the agent"}
          </button>
        </div>
      )}
      {note && <p className="mt-3 text-sm text-muted">{note}</p>}
    </section>
  );
}

function ChainSummary({ accountId, seen }: { accountId: string; seen: number }) {
  const [line, setLine] = useState("Reading the account.");
  useEffect(() => {
    let current = true;
    readChainRules(accountId).then((rules) => {
      if (!current || !rules) return;
      const people = rules.allowed.length;
      setLine(`${nearLabel(rules.max_per_payment)} NEAR per payment. ${nearLabel(rules.daily_cap)} NEAR a day. ${people} ${people === 1 ? "account" : "accounts"}. ${rules.open ? "Open" : "Locked"}.`);
    });
    return () => {
      current = false;
    };
  }, [accountId, seen]);
  return <p className="mt-3 text-sm">{line}</p>;
}

function DeskCode() {
  const rules = useDesk((s) => s.rules);
  const setRules = useDesk((s) => s.setRules);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const share = btoa(unescape(encodeURIComponent(JSON.stringify(rules))));

  function load() {
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!parsed || !Array.isArray(parsed.recipients)) throw new Error("bad");
      setRules(parsed);
      setNote("Rules loaded on this phone.");
    } catch {
      setNote("That code is not a Kyrona desk.");
    }
  }

  return (
    <div className="mt-6 grid gap-2">
      <p className="text-sm font-medium">Same rules on another phone</p>
      <p className="text-xs text-muted">Use this only if you do not want to sign. It is a copy, not the account.</p>
      <textarea readOnly value={share} className="field h-24 py-2 font-mono text-xs" />
      <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a desk code" className="field h-24 py-2 font-mono text-xs" />
      <button type="button" onClick={load} className="btn btn-quiet">
        Load code
      </button>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Vault({ open }: { open: boolean }) {
  return (
    <div className="vault" aria-hidden="true">
      <div className="vault-spin" />
      <div className="vault-spin vault-spin-b" />
      <div className="vault-core">
        <Mark className="h-16 w-auto" />
      </div>
      <div className="plate">
        <p className="kicker">{open ? "Gate open" : "Gate shut"}</p>
        <p className="mt-1 font-display text-lg">{open ? "Ready" : "Locked"}</p>
      </div>
    </div>
  );
}

function Mark({ className = "h-8 w-auto" }: { className?: string }) {
  return <img src="/logo.png" alt="" className={className} />;
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
        className="field nums"
      />
    </label>
  );
}


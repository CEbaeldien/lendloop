"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Header from "@/components/Header";
import ToolForm, { type ToolFields } from "@/components/ToolForm";
import { Activity, Empty, ErrorText, StatusPill, TrustedBadge, useAction } from "@/components/bits";
import { useStoreUser } from "@/lib/useStoreUser";
import { CATEGORY_KEYS, CATEGORY_LABELS, CONDITION_LABELS, errorMessage, formatDay, todayUtc } from "@/lib/format";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming requests" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function BoardPage() {
  const { me, isLoading } = useStoreUser();
  const [tab, setTab] = useState<Tab>("browse");
  const incoming = useQuery(api.loans.incoming, me ? {} : "skip");
  const pendingIncoming = incoming?.filter((l) => l.status === "pending").length ?? 0;

  return (
    <>
      <Header isAdmin={me?.role === "admin"} />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {me ? `Hi ${me.name.split(" ")[0]}` : "The board"}
        </h1>
        <div role="tablist" aria-label="Board sections" className="mt-6 flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.id === "incoming" && pendingIncoming > 0 && (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-white">{pendingIncoming}</span>
              )}
            </button>
          ))}
        </div>
        <div className="pt-6" role="tabpanel">
          {isLoading || !me ? (
            <p className="text-muted">Loading…</p>
          ) : tab === "browse" ? (
            <Browse />
          ) : tab === "listings" ? (
            <MyListings />
          ) : tab === "requests" ? (
            <MyRequests />
          ) : (
            <Incoming loans={incoming} />
          )}
        </div>
      </main>
    </>
  );
}

/* ── Browse ─────────────────────────────────────────────── */

function Browse() {
  const [category, setCategory] = useState<string>("");
  const tools = useQuery(api.tools.list, category ? { category: category as ToolArgs["category"] } : {});
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip active={category === ""} onClick={() => setCategory("")}>All</FilterChip>
        {CATEGORY_KEYS.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c]}</FilterChip>
        ))}
      </div>
      {tools === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : tools.length === 0 ? (
        <Empty>No tools in this category yet.</Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tools.map((t) => <ToolCard key={t._id} tool={t} />)}
        </ul>
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm font-medium ${
        active ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

type BoardTool = FunctionReturnType<typeof api.tools.list>[number];

function ToolCard({ tool }: { tool: BoardTool }) {
  const [open, setOpen] = useState(false);
  const a = tool.availability;
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-bold leading-tight">{tool.name}</h3>
        <span className="tag shrink-0">{CATEGORY_LABELS[tool.category]}</span>
      </div>
      {tool.description && <p className="mt-1.5 text-sm text-muted">{tool.description}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{CONDITION_LABELS[tool.condition]}</span>·
        <span>{tool.isMine ? "Your listing" : `Lent by ${tool.ownerName}`}</span>
        {tool.ownerTrusted && !tool.isMine && <TrustedBadge />}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className={`text-sm font-semibold ${a.state === "available" ? "text-ok" : a.overdue ? "text-warn" : "text-muted"}`}>
          {a.state === "available"
            ? a.nextBookingFrom ? `Available · booked from ${formatDay(a.nextBookingFrom)}` : "Available"
            : a.overdue ? `Overdue since ${formatDay(a.dueDate)}` : `On loan until ${formatDay(a.dueDate)}`}
        </span>
        {!tool.isMine && !open && (
          <button className="btn btn-ghost" onClick={() => setOpen(true)}>Request to borrow</button>
        )}
      </div>
      {open && <RequestForm toolId={tool._id} onDone={() => setOpen(false)} />}
    </li>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const today = todayUtc();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  if (sent) {
    return <p className="mt-3 text-sm font-medium text-ok">Request sent. The owner has been notified.</p>;
  }
  return (
    <form
      className="mt-3 grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, startDate: start, endDate: end }), errorMessage)) setSent(true);
      }}
    >
      <div>
        <label className="label" htmlFor={`from-${toolId}`}>From</label>
        <input id={`from-${toolId}`} type="date" className="field" min={today} value={start}
          onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
      </div>
      <div>
        <label className="label" htmlFor={`to-${toolId}`}>Until</label>
        <input id={`to-${toolId}`} type="date" className="field" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="col-span-2 flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
      <div className="col-span-2"><ErrorText message={error} /></div>
    </form>
  );
}

/* ── My listings ────────────────────────────────────────── */

type ToolArgs = FunctionArgs<typeof api.tools.create>;

/** The form holds plain strings; the server validates the enum values. */
function asToolArgs(f: ToolFields): ToolArgs {
  return {
    name: f.name,
    description: f.description,
    category: f.category as ToolArgs["category"],
    condition: f.condition as ToolArgs["condition"],
  };
}

function MyListings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 font-display text-xl font-bold">List a tool</h2>
        <ToolForm submitLabel="List it" onSubmit={(f) => create(asToolArgs(f))} />
      </section>
      <section>
        <h2 className="mb-4 font-display text-xl font-bold">Your tools</h2>
        {tools === undefined ? <p className="text-muted">Loading…</p>
          : tools.length === 0 ? <Empty>You haven&apos;t listed anything yet.</Empty>
          : <ul className="space-y-3">{tools.map((t) => <MyTool key={t._id} tool={t} />)}</ul>}
      </section>
    </div>
  );
}

type MyToolT = FunctionReturnType<typeof api.tools.mine>[number];

function MyTool({ tool }: { tool: MyToolT }) {
  const [editing, setEditing] = useState(false);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const { busy, error, run } = useAction();
  if (editing) {
    return (
      <li className="rounded-2xl border border-line bg-card p-4">
        <ToolForm
          initial={{ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (f: ToolFields) => { await update({ toolId: tool._id, ...asToolArgs(f) }); setEditing(false); }}
        />
      </li>
    );
  }
  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{tool.name}</p>
          <p className="text-xs text-muted">
            {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]} ·{" "}
            {tool.availability.state === "available" ? "Available" : `On loan until ${formatDay(tool.availability.dueDate)}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="btn btn-quiet" onClick={() => setEditing(true)}>Edit</button>
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${tool.name}"? Pending requests for it will be cancelled.`)) {
                run(() => remove({ toolId: tool._id }), errorMessage);
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <ErrorText message={error} />
    </li>
  );
}

/* ── My requests ────────────────────────────────────────── */

function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  if (loans === undefined) return <p className="text-muted">Loading…</p>;
  if (loans.length === 0) return <Empty>You haven&apos;t asked to borrow anything yet.</Empty>;
  return (
    <ul className="space-y-3">
      {loans.map((l) => (
        <LoanRow key={l._id} loan={l} who={`from ${l.otherFirstName}`} trusted={l.otherTrusted}>
          {l.status === "pending" && (
            <ActionButton label="Cancel request" kind="ghost" onClick={() => cancel({ loanId: l._id })} />
          )}
        </LoanRow>
      ))}
    </ul>
  );
}

/* ── Incoming ───────────────────────────────────────────── */

type LoanT = FunctionReturnType<typeof api.loans.incoming>[number];

function Incoming({ loans }: { loans: LoanT[] | undefined }) {
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  if (loans === undefined) return <p className="text-muted">Loading…</p>;
  if (loans.length === 0) return <Empty>No one has asked to borrow your tools yet.</Empty>;
  return (
    <ul className="space-y-3">
      {loans.map((l) => (
        <LoanRow key={l._id} loan={l} who={`by ${l.otherFirstName}`}>
          {l.status === "pending" && (
            <>
              <ActionButton label="Approve" kind="primary" onClick={() => decide({ loanId: l._id, approve: true })} />
              <ActionButton label="Decline" kind="ghost" onClick={() => decide({ loanId: l._id, approve: false })} />
            </>
          )}
          {l.status === "approved" && (
            <ActionButton label="Mark returned" kind="ghost" onClick={() => markReturned({ loanId: l._id })} />
          )}
        </LoanRow>
      ))}
    </ul>
  );
}

function LoanRow({ loan, who, trusted, children }: { loan: LoanT; who: string; trusted?: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-card p-4">
      <div>
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {loan.toolName} <StatusPill status={loan.status} overdue={loan.overdue} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
          {formatDay(loan.startDate)} – {formatDay(loan.endDate)} · {who}
          {trusted && <TrustedBadge />}
        </p>
        <Activity items={loan.activity} />
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function ActionButton({ label, kind, onClick }: { label: string; kind: "primary" | "ghost"; onClick: () => Promise<unknown> }) {
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-col items-end">
      <button className={`btn btn-${kind}`} disabled={busy} onClick={() => run(onClick, errorMessage)}>{label}</button>
      <ErrorText message={error} />
    </div>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Header from "@/components/Header";
import { Activity, Empty, ErrorText, StatusPill, useAction } from "@/components/bits";
import { useStoreUser } from "@/lib/useStoreUser";
import { CATEGORY_LABELS, errorMessage, formatDay } from "@/lib/format";

export default function AdminPage() {
  const { me, isLoading } = useStoreUser();
  const isAdmin = me?.role === "admin";
  return (
    <>
      <Header isAdmin={isAdmin} />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">Admin</h1>
        {isLoading ? (
          <p className="mt-6 text-muted">Loading…</p>
        ) : !isAdmin ? (
          // The page hides itself, but the real check is in every admin Convex function.
          <p className="mt-6 text-muted">This area is for admins.</p>
        ) : (
          <div className="mt-8 space-y-12">
            <Loans />
            <Listings />
            <Users />
          </div>
        )}
      </main>
    </>
  );
}

function Loans() {
  const loans = useQuery(api.loans.listForAdmin);
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-bold">All loans</h2>
      {loans === undefined ? <p className="text-muted">Loading…</p> : loans.length === 0 ? <Empty>No loans yet.</Empty> : (
        <ul className="space-y-3">
          {loans.map((l) => {
            const failed = l.deliveries.filter((d) => d.status === "failed");
            return (
              <li key={l._id} className="rounded-2xl border border-line bg-card p-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {l.toolName} <StatusPill status={l.status} overdue={l.overdue} />
                </p>
                <p className="text-sm text-muted">
                  {l.borrowerName} borrows from {l.lenderName} · {formatDay(l.startDate)} – {formatDay(l.endDate)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Webhooks: {l.deliveries.map((d) => `${d.event.replace("loan.", "")} ${d.status}`).join(", ") || "none"}
                </p>
                {failed.map((d, i) => (
                  <p key={i} className="text-xs font-medium text-warn">
                    {d.event} failed after {d.attempts} attempts: {d.lastError}
                  </p>
                ))}
                <Activity items={l.activity} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.list, {});
  const remove = useMutation(api.tools.remove);
  const { error, run } = useAction();
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-bold">All listings</h2>
      <ErrorText message={error} />
      {tools === undefined ? <p className="text-muted">Loading…</p> : tools.length === 0 ? <Empty>No listings.</Empty> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {tools.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-sm text-muted">· {CATEGORY_LABELS[t.category]} · {t.ownerName}</span>
              </span>
              <button
                className="btn btn-quiet"
                onClick={() => {
                  if (window.confirm(`Remove "${t.name}"? Open requests and loans on it will be cancelled.`)) {
                    run(() => remove({ toolId: t._id }), errorMessage);
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Users() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { error, run } = useAction();
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-bold">Lenders</h2>
      <ErrorText message={error} />
      {users === undefined ? <p className="text-muted">Loading…</p> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {users.map((u) => (
            <li key={u._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-sm text-muted">{u.email}{u.role === "admin" ? " · admin" : ""}</span>
              </span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={u.trustedLender}
                  onChange={(e) => run(() => setTrusted({ userId: u._id, trusted: e.target.checked }), errorMessage)}
                />
                Trusted lender
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

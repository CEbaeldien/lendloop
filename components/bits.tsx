"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/format";

export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  const label = overdue ? "Overdue" : status.charAt(0).toUpperCase() + status.slice(1);
  const tone = overdue
    ? "bg-[#fde3d2] text-warn"
    : status === "approved"
      ? "bg-[#d8ebdd] text-ok"
      : status === "pending"
        ? "bg-[#f3ecd3] text-[#6b5512]"
        : "bg-[#e7ebe5] text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
}

export function TrustedBadge() {
  return (
    <span title="Marked trusted by an admin" className="rounded-full bg-[#d8ebdd] px-1.5 py-0.5 text-[0.7rem] font-bold text-ok">
      ✓ Trusted lender
    </span>
  );
}

const KIND_LABEL: Record<string, string> = {
  request_notification: "Notification",
  overdue_reminder: "Reminder",
};

/** "Reminder sent 2 days ago" — what the n8n automations did for a loan. */
export function Activity({ items }: { items: { kind: string; status: string; at: number }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted">
      {items.slice(0, 3).map((a, i) => (
        <li key={i}>
          {KIND_LABEL[a.kind] ?? a.kind} {a.status === "sent" ? "sent" : "failed"} {timeAgo(a.at)}
        </li>
      ))}
    </ul>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="mt-2 text-sm font-medium text-warn">{message}</p>;
}

/** Wraps an async action with a busy flag and a readable error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, toMessage: (e: unknown) => string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-8 text-center text-muted">{children}</p>;
}

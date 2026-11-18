"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Show, SignInButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import Header from "@/components/Header";
import { CATEGORY_LABELS } from "@/lib/format";

export default function PublicPage() {
  const tools = useQuery(api.tools.publicList);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14 sm:py-20">
          <p className="tag mb-5">Your street&apos;s shared shed</p>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Borrow what you need.
            <br />
            Lend what you don&apos;t.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            List the drill you use twice a year, borrow the ladder you need once. Requests, approvals and
            return reminders are handled for you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="btn btn-primary text-base">Sign in to lend or borrow</button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/app" className="btn btn-primary text-base">Open the board</Link>
            </Show>
          </div>
        </section>

        <section aria-labelledby="available" className="pb-20">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="available" className="font-display text-2xl font-bold">Available now</h2>
            {tools && <span className="text-sm text-muted">{tools.length} tools</span>}
          </div>
          {tools === undefined ? (
            <p className="text-muted">Loading…</p>
          ) : tools.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
              Nothing listed yet. Sign in and lend the first tool.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t, i) => (
                <li key={`${t.name}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
                  <span className="font-medium">{t.name}</span>
                  <span className="tag shrink-0">{CATEGORY_LABELS[t.category] ?? t.category}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

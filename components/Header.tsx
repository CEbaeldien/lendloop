"use client";

import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { InstallButton } from "./Pwa";

export default function Header({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
          <Loop />
          LendLoop
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <InstallButton />
          <Show when="signed-in">
            <Link href="/app" className="btn btn-quiet">Board</Link>
            {isAdmin && <Link href="/admin" className="btn btn-quiet">Admin</Link>}
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="btn btn-primary">Sign in to lend or borrow</button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}

function Loop() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="12" cy="16" r="8" fill="none" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="20" cy="16" r="8" fill="none" stroke="var(--accent)" strokeWidth="3" />
    </svg>
  );
}

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween } from "./lib/dates";

export const reminderKey = (loanId: string, day: string) => `reminder:${loanId}:${day}`;

/**
 * Approved, unreturned loans whose end date is before `today`, minus any
 * that already got a successful reminder today. Returns only what a
 * reminder needs: the borrower's name and email, the tool name, the due date.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);
    const out = [];
    for (const loan of loans) {
      const key = reminderKey(loan._id, today);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (already?.status === "sent") continue;
      const [tool, borrower, lender] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.lenderId),
      ]);
      if (!borrower) continue;
      out.push({
        loanId: loan._id,
        reminderKey: key,
        borrower: { name: borrower.name, email: borrower.email },
        lenderFirstName: lender?.name.split(" ")[0] ?? "the lender",
        tool: { name: tool?.name ?? "a removed listing" },
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return out;
  },
});

/**
 * Idempotent write-back from n8n. The same key twice is a no-op, so n8n can
 * retry freely. A later "sent" upgrades an earlier "failed" (the retry
 * worked); a later "failed" never overwrites a "sent".
 */
export const recordEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: v.union(v.literal("request_notification"), v.literal("overdue_reminder")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return { ok: false as const, reason: "unknown loan" };
    const detail = args.detail?.slice(0, 300);
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", detail, at: Date.now() });
        return { ok: true as const, duplicate: false, upgraded: true };
      }
      return { ok: true as const, duplicate: true };
    }
    await ctx.db.insert("automationEvents", { ...args, detail, at: Date.now() });
    return { ok: true as const, duplicate: false };
  },
});

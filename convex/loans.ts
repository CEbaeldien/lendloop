import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { forbidden, invalid, requireAdmin, requireUser } from "./lib/auth";
import { daysBetween, isValidDay, overlaps, todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./notifications";

const MAX_LOAN_DAYS = 30;

async function approvedOverlap(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  start: string,
  end: string,
  exceptId?: Id<"loans">,
) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.eq(q.field("status"), "approved"))
    .collect();
  return approved.some((l) => l._id !== exceptId && overlaps(start, end, l.startDate, l.endDate));
}

/** Borrow request for a date range (inclusive, UTC days). */
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) invalid("Tool not found.");
    if (tool.ownerId === me._id) invalid("You can't borrow your own tool.");
    if (!isValidDay(startDate) || !isValidDay(endDate)) invalid("Dates must be YYYY-MM-DD.");
    if (startDate < todayUtc()) invalid("The start date has already passed.");
    if (endDate < startDate) invalid("The end date is before the start date.");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) invalid(`Loans are limited to ${MAX_LOAN_DAYS} days.`);
    if (await approvedOverlap(ctx, toolId, startDate, endDate)) {
      invalid("The tool is already booked for some of those days.");
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .filter((q) => q.and(q.eq(q.field("toolId"), toolId), q.eq(q.field("status"), "pending")))
      .collect();
    if (mine.some((l) => overlaps(startDate, endDate, l.startDate, l.endDate))) {
      invalid("You already have a pending request for those days.");
    }
    const loanId = await ctx.db.insert("loans", {
      toolId,
      lenderId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
      createdAt: Date.now(),
    });
    await enqueueLoanEvent(ctx, loanId, "loan.requested");
    return loanId;
  },
});

/** Only the tool's owner decides on a request. */
export const decide = mutation({
  args: { loanId: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, { loanId, approve }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) invalid("Request not found.");
    if (loan.lenderId !== me._id) forbidden("Only the tool's owner can decide on this request.");
    if (loan.status !== "pending") invalid(`This request is already ${loan.status}.`);
    const now = Date.now();

    if (!approve) {
      await ctx.db.patch(loanId, { status: "declined", decidedAt: now });
      await enqueueLoanEvent(ctx, loanId, "loan.declined");
      return;
    }
    if (await approvedOverlap(ctx, loan.toolId, loan.startDate, loan.endDate, loanId)) {
      invalid("Another approved loan already covers some of those days.");
    }
    await ctx.db.patch(loanId, { status: "approved", decidedAt: now });
    await enqueueLoanEvent(ctx, loanId, "loan.approved");

    // Requests that now clash can no longer be approved: decline them.
    const clashing = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    for (const other of clashing) {
      if (other._id !== loanId && overlaps(loan.startDate, loan.endDate, other.startDate, other.endDate)) {
        await ctx.db.patch(other._id, { status: "declined", decidedAt: now });
        await enqueueLoanEvent(ctx, other._id, "loan.declined");
      }
    }
  },
});

/** The lender confirms the tool came back (admins can too). */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) invalid("Loan not found.");
    if (loan.lenderId !== me._id && me.role !== "admin") {
      forbidden("Only the lender can mark this loan returned.");
    }
    if (loan.status !== "approved") invalid(`Only an approved loan can be returned (this one is ${loan.status}).`);
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "loan.returned");
  },
});

/** A borrower withdraws their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) invalid("Request not found.");
    if (loan.borrowerId !== me._id) forbidden("You can only cancel your own requests.");
    if (loan.status !== "pending") invalid(`This request is already ${loan.status}.`);
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
  },
});

async function activityFor(ctx: QueryCtx, loanId: Id<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(10);
  return events.map((e) => ({ kind: e.kind, status: e.status, at: e.at }));
}

async function present(ctx: QueryCtx, loan: Doc<"loans">, viewer: "borrower" | "lender") {
  const tool = await ctx.db.get(loan.toolId);
  const otherId = viewer === "borrower" ? loan.lenderId : loan.borrowerId;
  const other = await ctx.db.get(otherId);
  const today = todayUtc();
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed listing",
    otherFirstName: other?.name.split(" ")[0] ?? "Neighbour",
    otherTrusted: viewer === "borrower" ? (other?.trustedLender ?? false) : false,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    createdAt: loan.createdAt,
    activity: await activityFor(ctx, loan._id),
  };
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => present(ctx, l, "borrower")));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((l) => present(ctx, l, "lender")));
  },
});

/** Admin overview of every loan plus the state of its webhook deliveries. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(300);
    const today = todayUtc();
    return await Promise.all(
      loans.map(async (l) => {
        const [tool, lender, borrower] = await Promise.all([
          ctx.db.get(l.toolId),
          ctx.db.get(l.lenderId),
          ctx.db.get(l.borrowerId),
        ]);
        const deliveries = await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_loan", (q) => q.eq("loanId", l._id))
          .collect();
        return {
          _id: l._id,
          toolName: tool?.name ?? "Removed listing",
          lenderName: lender?.name ?? "?",
          borrowerName: borrower?.name ?? "?",
          startDate: l.startDate,
          endDate: l.endDate,
          status: l.status,
          overdue: l.status === "approved" && l.endDate < today,
          deliveries: deliveries.map((d) => ({
            event: d.event,
            status: d.status,
            attempts: d.attempts,
            lastError: d.lastError,
          })),
          activity: await activityFor(ctx, l._id),
        };
      }),
    );
  },
});

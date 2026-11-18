import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signRequest } from "./lib/signature";

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s, 1m, 2m, 4m
const REQUEST_TIMEOUT_MS = 10_000;

type LoanEvent = "loan.requested" | "loan.approved" | "loan.declined" | "loan.returned";

/**
 * Store a loan event in the outbox and schedule its delivery to n8n.
 * Runs inside the same transaction as the state change, so an event is
 * recorded if and only if the change committed.
 *
 * The body carries only what the workflow needs to send one message:
 * the recipient's name and email, the tool name, the dates, and the other
 * person's first name. No ids of users, no descriptions, no addresses.
 */
export async function enqueueLoanEvent(ctx: MutationCtx, loanId: Id<"loans">, event: LoanEvent) {
  const loan = await ctx.db.get(loanId);
  if (!loan) return;
  const [tool, lender, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
  ]);
  if (!lender || !borrower) return;
  // A new request goes to the lender; every decision goes to the borrower.
  const [recipient, other] = event === "loan.requested" ? [lender, borrower] : [borrower, lender];

  const now = Date.now();
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    loanId,
    event,
    body: "",
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  const body = JSON.stringify({
    event,
    deliveryId,
    loanId,
    occurredAt: new Date(now).toISOString(),
    recipient: { name: recipient.name, email: recipient.email },
    otherPartyFirstName: other.name.split(" ")[0],
    tool: { name: tool?.name ?? "a removed listing" },
    loan: { startDate: loan.startDate, endDate: loan.endDate, status: loan.status },
  });
  await ctx.db.patch(deliveryId, { body });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { deliveryId });
}

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: (ctx, { deliveryId }) => ctx.db.get(deliveryId),
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    outcome: v.union(v.literal("delivered"), v.literal("error"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deliveryId, outcome, error }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status === "delivered") return { retryInMs: null };
    const attempts = d.attempts + 1;
    if (outcome === "delivered") {
      await ctx.db.patch(deliveryId, { status: "delivered", attempts, lastError: undefined, updatedAt: Date.now() });
      return { retryInMs: null };
    }
    if (outcome === "skipped") {
      await ctx.db.patch(deliveryId, { status: "skipped", attempts, lastError: error, updatedAt: Date.now() });
      return { retryInMs: null };
    }
    const giveUp = attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(deliveryId, {
      status: giveUp ? "failed" : "pending",
      attempts,
      lastError: error,
      updatedAt: Date.now(),
    });
    if (giveUp) return { retryInMs: null };
    const retryInMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
    await ctx.scheduler.runAfter(retryInMs, internal.notifications.deliver, { deliveryId });
    return { retryInMs };
  },
});

/**
 * POST the stored event to the n8n webhook, signed with N8N_WEBHOOK_SECRET.
 * Non-2xx responses and network errors are retried with exponential backoff;
 * after MAX_ATTEMPTS the delivery is marked failed and shows up for admins.
 * n8n receives X-LendLoop-Delivery so it can ignore a duplicate delivery.
 */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.runQuery(internal.notifications.getDelivery, { deliveryId });
    if (!delivery || delivery.status !== "pending") return;

    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        deliveryId,
        outcome: "skipped",
        error: "N8N_REQUEST_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set",
      });
      return;
    }

    let outcome: "delivered" | "error" = "error";
    let error: string | undefined;
    try {
      const path = new URL(url).pathname;
      const headers = await signRequest(secret, "POST", path, delivery.body);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LendLoop-Delivery": deliveryId, ...headers },
        body: delivery.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) outcome = "delivered";
      else error = `n8n responded ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.runMutation(internal.notifications.recordAttempt, { deliveryId, outcome, error });
  },
});

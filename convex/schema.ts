import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export const CONDITIONS = ["like_new", "good", "fair", "worn"] as const;

export const categoryValidator = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const conditionValidator = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled"),
);

export const loanEventValidator = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.returned"),
);

export default defineSchema({
  // One row per signed-in person. The role is decided on the server
  // (ADMIN_EMAILS env var on first sign-in), never taken from the client.
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
    createdAt: v.number(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  // A borrow request and, once approved, the loan itself.
  // Dates are calendar days in UTC, formatted YYYY-MM-DD.
  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatusValidator,
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_lender", ["lenderId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Outbox for Convex -> n8n webhooks. Every event is stored first and
  // delivered by a scheduled action, so a failed call is retried and stays
  // visible instead of disappearing.
  webhookDeliveries: defineTable({
    loanId: v.id("loans"),
    event: loanEventValidator,
    body: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),

  // What the automations did, written back by n8n. The idempotency key is
  // unique per action (delivery id for notifications, loanId:date for
  // reminders), so a retried write-back never creates a second row.
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: v.union(v.literal("request_notification"), v.literal("overdue_reminder")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),
});

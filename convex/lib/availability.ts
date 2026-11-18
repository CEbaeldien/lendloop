import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type Availability =
  | { state: "available"; nextBookingFrom?: string }
  | { state: "on_loan"; dueDate: string; overdue: boolean };

/**
 * A tool is on loan when it has an approved loan that has started and has
 * not been marked returned (an overdue loan still counts as out).
 */
export async function availabilityOf(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  today: string,
): Promise<Availability> {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.eq(q.field("status"), "approved"))
    .collect();
  const out = approved.find((l) => l.startDate <= today);
  if (out) return { state: "on_loan", dueDate: out.endDate, overdue: out.endDate < today };
  const next = approved.map((l) => l.startDate).sort()[0];
  return next ? { state: "available", nextBookingFrom: next } : { state: "available" };
}

import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user's row, or null when signed out or not yet stored. */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/** Every write and every private read goes through one of these two guards. */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admins only." });
  }
  return user;
}

export function forbidden(message: string): never {
  throw new ConvexError({ code: "FORBIDDEN", message });
}

export function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID", message });
}

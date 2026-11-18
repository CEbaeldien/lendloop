import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser, requireAdmin } from "./lib/auth";
import { ConvexError } from "convex/values";

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Called by the client after sign-in. Creates or refreshes the caller's row
 * from the verified identity. The role is decided here, from ADMIN_EMAILS,
 * and only when the row is first created; a client can never pass a role.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    const email = (identity.email ?? "").toLowerCase();
    const name = identity.name ?? identity.givenName ?? (email.split("@")[0] || "Neighbour");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: adminEmails().has(email) ? "admin" : "user",
      trustedLender: false,
      createdAt: Date.now(),
    });
  },
});

/** The caller's own profile; email is only ever returned to its owner. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

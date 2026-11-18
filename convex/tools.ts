import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { categoryValidator, conditionValidator } from "./schema";
import { currentUser, forbidden, invalid, requireUser } from "./lib/auth";
import { availabilityOf } from "./lib/availability";
import { todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./notifications";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function clean(fields: { name: string; description: string }) {
  const name = fields.name.trim();
  const description = fields.description.trim();
  if (name.length < 2 || name.length > MAX_NAME) invalid(`Name must be 2-${MAX_NAME} characters.`);
  if (description.length > MAX_DESCRIPTION) invalid(`Description must be ${MAX_DESCRIPTION} characters or fewer.`);
  return { name, description };
}

/**
 * Public, signed-out view: available tools only, and only name + category.
 * No owner, condition, description or ids leave the server here.
 */
export const publicList = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const rows: { name: string; category: string }[] = [];
    for (const t of tools) {
      const a = await availabilityOf(ctx, t._id, today);
      if (a.state === "available") rows.push({ name: t.name, category: t.category });
    }
    return rows;
  },
});

/** Signed-in board: every tool with its availability, optional category filter. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
          .take(200)
      : await ctx.db.query("tools").order("desc").take(200);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          // First name only: enough to know who you are borrowing from.
          ownerName: owner?.name.split(" ")[0] ?? "Neighbour",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
          availability: await availabilityOf(ctx, t._id, today),
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);
    if (!me) return [];
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(
      tools.map(async (t) => ({ ...t, availability: await availabilityOf(ctx, t._id, today) })),
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const { name, description } = clean(args);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) invalid("Tool not found.");
    // Editing is owner-only; admins moderate by removing, not rewriting.
    if (tool.ownerId !== me._id) forbidden("You can only edit your own listings.");
    const { name, description } = clean(fields);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: fields.category,
      condition: fields.condition,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Owners delete their own listing (not while it is out on loan).
 * Admins can remove any listing; open requests and loans on it are cancelled
 * and the people involved are notified.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) invalid("Tool not found.");
    const isOwner = tool.ownerId === me._id;
    const isAdmin = me.role === "admin";
    if (!isOwner && !isAdmin) forbidden("You can only remove your own listings.");

    const open = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "approved")))
      .collect();
    const today = todayUtc();
    if (!isAdmin && open.some((l) => l.status === "approved" && l.startDate <= today)) {
      invalid("This tool is out on loan. Mark it returned before removing it.");
    }
    await cancelLoans(ctx, open.map((l) => l._id));
    await ctx.db.delete(toolId);
  },
});

async function cancelLoans(ctx: MutationCtx, loanIds: Id<"loans">[]) {
  for (const id of loanIds) {
    await ctx.db.patch(id, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, id, "loan.declined");
  }
}

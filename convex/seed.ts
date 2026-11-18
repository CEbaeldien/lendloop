import { internalMutation } from "./_generated/server";

// Demo data for local development: `npx convex run seed:demo`.
// Internal, so it can only be run with the deployment's admin key (CLI or
// dashboard), never from the browser. Refuses to run twice.
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query("tools").take(1)).length > 0) return "Already seeded.";
    const now = Date.now();
    const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
    const user = (name: string, email: string, role: "admin" | "user", trusted = false) =>
      ctx.db.insert("users", {
        tokenIdentifier: `seed|${email}`,
        name,
        email,
        role,
        trustedLender: trusted,
        createdAt: now,
      });
    const maya = await user("Maya Okafor", "maya@example.com", "user", true);
    const tom = await user("Tom Reyes", "tom@example.com", "user");
    const lina = await user("Lina Haddad", "lina@example.com", "user");

    const tool = (ownerId: typeof maya, name: string, category: never, condition: never, description: string) =>
      ctx.db.insert("tools", { ownerId, name, category, condition, description, createdAt: now, updatedAt: now });
    const drill = await tool(maya, "Cordless drill", "power_tools" as never, "good" as never, "18V with two batteries and a bit set.");
    await tool(maya, "Extension ladder", "hand_tools" as never, "fair" as never, "3.5 m, aluminium. Heavy, bring a friend.");
    const tent = await tool(tom, "Four-person tent", "camping" as never, "like_new" as never, "Pitched twice. Pegs and footprint included.");
    await tool(tom, "Hedge trimmer", "garden" as never, "good" as never, "Electric, 10 m cable.");
    await tool(lina, "Stand mixer", "kitchen" as never, "good" as never, "Dough hook, whisk and paddle.");
    await tool(lina, "Carpet cleaner", "cleaning" as never, "worn" as never, "Works well, tank lid is cracked.");

    // One overdue loan, one current loan, one pending request.
    await ctx.db.insert("loans", { toolId: drill, lenderId: maya, borrowerId: tom, startDate: day(-6), endDate: day(-2), status: "approved", createdAt: now, decidedAt: now });
    await ctx.db.insert("loans", { toolId: tent, lenderId: tom, borrowerId: lina, startDate: day(-1), endDate: day(3), status: "approved", createdAt: now, decidedAt: now });
    await ctx.db.insert("loans", { toolId: tent, lenderId: tom, borrowerId: maya, startDate: day(5), endDate: day(7), status: "pending", createdAt: now });
    return "Seeded 3 people, 6 tools, 3 loans.";
  },
});

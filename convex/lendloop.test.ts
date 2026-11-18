import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { hmacHex, signRequest, signedMessage, verifyRequest } from "./lib/signature";

const ALICE = { subject: "alice", email: "alice@example.com", name: "Alice Lender" };
const BOB = { subject: "bob", email: "bob@example.com", name: "Bob Borrower" };
const CAROL = { subject: "carol", email: "carol@example.com", name: "Carol Other" };
const ADMIN = { subject: "admin", email: "admin@example.com", name: "Ada Admin" };

function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity(ALICE);
  const bob = t.withIdentity(BOB);
  const carol = t.withIdentity(CAROL);
  const admin = t.withIdentity(ADMIN);
  for (const u of [alice, bob, carol, admin]) await u.mutation(api.users.store, {});
  const toolId = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V, two batteries",
  });
  return { t, alice, bob, carol, admin, toolId };
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("roles", () => {
  test("role comes from ADMIN_EMAILS on the server, not the client", async () => {
    const { alice, admin } = await setup();
    expect((await alice.query(api.users.me, {}))?.role).toBe("user");
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
  });

  test("signed-out callers cannot read private views or write", async () => {
    const { t, toolId } = await setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/Sign in/);
    await expect(t.mutation(api.tools.remove, { toolId })).rejects.toThrow(/Sign in/);
    await expect(
      t.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) }),
    ).rejects.toThrow(/Sign in/);
  });

  test("users can only edit and delete their own listings", async () => {
    const { bob, toolId } = await setup();
    await expect(
      bob.mutation(api.tools.update, {
        toolId, name: "Mine now", category: "garden", condition: "worn", description: "",
      }),
    ).rejects.toThrow(/your own listings/);
    await expect(bob.mutation(api.tools.remove, { toolId })).rejects.toThrow(/your own listings/);
  });

  test("admins can remove any listing; open requests are cancelled", async () => {
    const { admin, bob, toolId } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await admin.mutation(api.tools.remove, { toolId });
    const mine = await bob.query(api.loans.myRequests, {});
    expect(mine.find((l) => l._id === loanId)?.status).toBe("cancelled");
  });

  test("admin-only queries and mutations reject normal users", async () => {
    const { alice, bob } = await setup();
    const bobId = (await bob.query(api.users.me, {}))!._id;
    await expect(alice.query(api.users.listForAdmin, {})).rejects.toThrow(/Admins only/);
    await expect(alice.query(api.loans.listForAdmin, {})).rejects.toThrow(/Admins only/);
    await expect(
      alice.mutation(api.users.setTrustedLender, { userId: bobId, trusted: true }),
    ).rejects.toThrow(/Admins only/);
  });

  test("admins can mark a trusted lender", async () => {
    const { admin, alice } = await setup();
    const aliceId = (await alice.query(api.users.me, {}))!._id;
    await admin.mutation(api.users.setTrustedLender, { userId: aliceId, trusted: true });
    expect((await alice.query(api.users.me, {}))?.trustedLender).toBe(true);
  });
});

describe("public page", () => {
  test("shows name and category only, and hides tools that are out", async () => {
    const { t, alice, bob, toolId } = await setup();
    const rows = await t.query(api.tools.publicList, {});
    expect(rows).toEqual([{ name: "Cordless drill", category: "power_tools" }]);

    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(2) });
    await alice.mutation(api.loans.decide, { loanId, approve: true });
    expect(await t.query(api.tools.publicList, {})).toEqual([]);
  });
});

describe("borrowing", () => {
  test("cannot borrow your own tool or use bad dates", async () => {
    const { alice, bob, toolId } = await setup();
    await expect(
      alice.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) }),
    ).rejects.toThrow(/own tool/);
    await expect(
      bob.mutation(api.loans.request, { toolId, startDate: day(3), endDate: day(1) }),
    ).rejects.toThrow(/before the start/);
    await expect(
      bob.mutation(api.loans.request, { toolId, startDate: day(-2), endDate: day(1) }),
    ).rejects.toThrow(/already passed/);
  });

  test("only the owner decides; approval declines clashing requests", async () => {
    const { alice, bob, carol, toolId } = await setup();
    const bobLoan = await bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(3) });
    const carolLoan = await carol.mutation(api.loans.request, { toolId, startDate: day(2), endDate: day(4) });

    await expect(carol.mutation(api.loans.decide, { loanId: bobLoan, approve: true })).rejects.toThrow(
      /Only the tool's owner/,
    );
    await alice.mutation(api.loans.decide, { loanId: bobLoan, approve: true });
    const carolView = await carol.query(api.loans.myRequests, {});
    expect(carolView.find((l) => l._id === carolLoan)?.status).toBe("declined");

    await expect(
      carol.mutation(api.loans.request, { toolId, startDate: day(3), endDate: day(5) }),
    ).rejects.toThrow(/already booked/);
  });

  test("only the lender (or an admin) marks a loan returned", async () => {
    const { alice, bob, toolId } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    await alice.mutation(api.loans.decide, { loanId, approve: true });
    await expect(bob.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/Only the lender/);
    await alice.mutation(api.loans.markReturned, { loanId });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });
});

describe("webhook outbox", () => {
  test("each event is stored with a minimal body and delivered, signed", async () => {
    vi.stubEnv("N8N_REQUEST_WEBHOOK_URL", "https://n8n.example.com/webhook/lendloop-loan-events");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-secret");
    const calls: { headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response("ok", { status: 200 });
    }));

    const { t, bob, toolId } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body);
    expect(body.event).toBe("loan.requested");
    expect(body.recipient).toEqual({ name: "Alice Lender", email: "alice@example.com" });
    expect(body.otherPartyFirstName).toBe("Bob");
    expect(Object.keys(body).sort()).toEqual(
      ["deliveryId", "event", "loan", "loanId", "occurredAt", "otherPartyFirstName", "recipient", "tool"].sort(),
    );
    const ok = await verifyRequest("test-secret", {
      method: "POST",
      path: "/webhook/lendloop-loan-events",
      body: calls[0].body,
      timestamp: calls[0].headers["X-LendLoop-Timestamp"],
      signature: calls[0].headers["X-LendLoop-Signature"],
    });
    expect(ok.ok).toBe(true);
  });

  test("failures retry with backoff, then stop and stay visible", async () => {
    vi.stubEnv("N8N_REQUEST_WEBHOOK_URL", "https://n8n.example.com/webhook/x");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-secret");
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const { t, bob, admin, toolId } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const loans = await admin.query(api.loans.listForAdmin, {});
    expect(loans[0].deliveries[0]).toMatchObject({ status: "failed", attempts: 5, lastError: "n8n responded 503" });
  });

  test("without n8n configured, events are marked skipped instead of erroring", async () => {
    const { t, bob, admin, toolId } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const loans = await admin.query(api.loans.listForAdmin, {});
    expect(loans[0].deliveries[0].status).toBe("skipped");
  });
});

describe("automation write-backs", () => {
  async function overdueLoan() {
    const ctx = await setup();
    const loanId = await ctx.bob.mutation(api.loans.request, {
      toolId: ctx.toolId, startDate: day(0), endDate: day(1),
    });
    await ctx.alice.mutation(api.loans.decide, { loanId, approve: true });
    vi.setSystemTime(Date.now() + 3 * 86_400_000); // three days later
    return { ...ctx, loanId };
  }

  test("overdue query returns only what a reminder needs", async () => {
    const { t } = await overdueLoan();
    const rows = await t.query(internal.automation.overdueLoans, { today: day(0) });
    expect(rows).toHaveLength(1);
    expect(rows[0].borrower).toEqual({ name: "Bob Borrower", email: "bob@example.com" });
    expect(rows[0].daysOverdue).toBe(2);
  });

  test("the same reminder recorded twice creates one row and drops out of the next fetch", async () => {
    const { t, loanId, bob } = await overdueLoan();
    const [row] = await t.query(internal.automation.overdueLoans, { today: day(0) });
    const args = { idempotencyKey: row.reminderKey, loanId, kind: "overdue_reminder" as const, status: "sent" as const };
    expect(await t.mutation(internal.automation.recordEvent, args)).toMatchObject({ duplicate: false });
    expect(await t.mutation(internal.automation.recordEvent, args)).toMatchObject({ duplicate: true });
    expect(await t.query(internal.automation.overdueLoans, { today: day(0) })).toHaveLength(0);
    const mine = await bob.query(api.loans.myRequests, {});
    expect(mine[0].activity).toHaveLength(1);
  });

  test("a later success upgrades a failure; a later failure never downgrades a success", async () => {
    const { t, loanId } = await overdueLoan();
    const base = { idempotencyKey: "k1", loanId, kind: "overdue_reminder" as const };
    await t.mutation(internal.automation.recordEvent, { ...base, status: "failed" });
    expect(await t.mutation(internal.automation.recordEvent, { ...base, status: "sent" })).toMatchObject({
      upgraded: true,
    });
    expect(await t.mutation(internal.automation.recordEvent, { ...base, status: "failed" })).toMatchObject({
      duplicate: true,
    });
  });
});

describe("signatures", () => {
  test("verify accepts a fresh signature and rejects tampering, replay and cross-path use", async () => {
    vi.useRealTimers();
    const h = await signRequest("s3cret", "POST", "/n8n/automation-events", '{"a":1}');
    const base = {
      method: "POST", path: "/n8n/automation-events", body: '{"a":1}',
      timestamp: h["X-LendLoop-Timestamp"], signature: h["X-LendLoop-Signature"],
    };
    expect((await verifyRequest("s3cret", base)).ok).toBe(true);
    expect((await verifyRequest("s3cret", { ...base, body: '{"a":2}' })).ok).toBe(false);
    expect((await verifyRequest("s3cret", { ...base, path: "/n8n/overdue-loans" })).ok).toBe(false);
    expect((await verifyRequest("wrong", base)).ok).toBe(false);
    expect((await verifyRequest(undefined, base)).ok).toBe(false);
    expect((await verifyRequest("s3cret", { ...base, nowMs: Date.now() + 10 * 60_000 })).ok).toBe(false);
  });

  test("matches the Node crypto implementation used in the n8n Code nodes", async () => {
    vi.useRealTimers();
    const msg = signedMessage("1700000000", "get", "/x", "");
    expect(msg).toBe("1700000000.GET./x.");
    expect(await hmacHex("k", "abc")).toBe(
      "342e519ce0ad6c03a36b98eeb3f1d130db4813b9df4d1160eda488d712dc78ee",
    );
  });
});

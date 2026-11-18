import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "./lib/signature";
import { todayUtc } from "./lib/dates";

const http = httpRouter();

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Verify the n8n -> Convex signature; returns a 401 response on failure. */
async function verify(req: Request, body: string): Promise<Response | null> {
  const result = await verifyRequest(process.env.N8N_WEBHOOK_SECRET, {
    method: req.method,
    path: new URL(req.url).pathname,
    body,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
  });
  // The reason is logged server-side but not returned to the caller.
  if (!result.ok) {
    console.warn(`Rejected n8n request: ${result.reason}`);
    return json(401, { error: "invalid signature" });
  }
  return null;
}

// Daily reminder workflow: fetch loans that are overdue today.
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const denied = await verify(req, "");
    if (denied) return denied;
    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { date: today, loans });
  }),
});

// Both workflows: write back what happened (idempotent on idempotencyKey).
http.route({
  path: "/n8n/automation-events",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const denied = await verify(req, body);
    if (denied) return denied;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    const { idempotencyKey, loanId, kind, status, detail } = data;
    if (
      typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 200 ||
      typeof loanId !== "string" ||
      (kind !== "request_notification" && kind !== "overdue_reminder") ||
      (status !== "sent" && status !== "failed") ||
      (detail !== undefined && typeof detail !== "string")
    ) {
      return json(400, { error: "expected idempotencyKey, loanId, kind, status[, detail]" });
    }
    // The mutation's v.id("loans") validator rejects ids that aren't loans.
    let result;
    try {
      result = await ctx.runMutation(internal.automation.recordEvent, {
        idempotencyKey,
        loanId: loanId as never,
        kind,
        status,
        detail: detail as string | undefined,
      });
    } catch {
      return json(400, { error: "unknown loanId" });
    }
    return json(result.ok ? 200 : 404, result);
  }),
});

export default http;

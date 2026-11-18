// Generates the n8n workflow exports in n8n/workflows/.
// Run: node scripts/build-n8n-workflows.mjs
//
// Kept as code so the Code-node JavaScript is reviewable and the exports
// never contain secrets: every secret is read at run time from the n8n
// environment ($env) or an n8n credential.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const ERROR_WORKFLOW_ID = "LendLoopErrors01";

// ── Shared Code-node snippets ─────────────────────────────────────────────

const SIGN_HELPERS = String.raw`
const crypto = require('crypto');
const secret = $env.LENDLOOP_WEBHOOK_SECRET;
if (!secret) throw new Error('LENDLOOP_WEBHOOK_SECRET is not set in the n8n environment');
// Same scheme as Convex: HMAC-SHA256 over "timestamp.METHOD.path.body", hex.
function sign(method, path, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + method + '.' + path + '.' + body).digest('hex');
  return { timestamp, signature };
}`;

// Builds the signed write-back request for each incoming item.
// Expects item.json.writeBack = { idempotencyKey, loanId, kind, status, detail? }
const SIGN_WRITE_BACK = SIGN_HELPERS + String.raw`
const path = '/n8n/automation-events';
return $input.all().map((item) => {
  const body = JSON.stringify(item.json.writeBack);
  return { json: { body, ...sign('POST', path, body) } };
});`;

// ── Workflow 1: request notifications ─────────────────────────────────────

const VERIFY_WEBHOOK = String.raw`
const crypto = require('crypto');
const secret = $env.LENDLOOP_WEBHOOK_SECRET;
// The path Convex signed: the pathname of N8N_REQUEST_WEBHOOK_URL.
const path = $env.LENDLOOP_REQUEST_WEBHOOK_PATH || '/webhook/lendloop-loan-events';
const MAX_SKEW = 300; // seconds

const item = $input.first();
const h = item.json.headers || {};
const ts = h['x-lendloop-timestamp'];
const sig = (h['x-lendloop-signature'] || '').toLowerCase();
const deliveryId = h['x-lendloop-delivery'] || '';

// Verify against the exact bytes received, not a re-serialised object.
let raw = '';
if (item.binary && item.binary.data) {
  raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
}

function reject(reason) {
  // Logged for the operator; the caller only sees a generic 401.
  console.log('LendLoop webhook rejected: ' + reason);
  return [{ json: { valid: false, reason } }];
}
if (!secret) return reject('LENDLOOP_WEBHOOK_SECRET not set');
if (!ts || !sig || !raw) return reject('missing signature, timestamp or body');
if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW) return reject('stale timestamp');

const expected = crypto.createHmac('sha256', secret).update(ts + '.POST.' + path + '.' + raw).digest('hex');
const a = Buffer.from(expected, 'hex'), b = Buffer.from(sig, 'hex');
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reject('signature mismatch');

const event = JSON.parse(raw);
if (event.deliveryId !== deliveryId) return reject('delivery id header does not match body');

// Convex retries a delivery if our 2xx was lost. Remember recent delivery
// ids (workflow static data persists across production executions) so a
// retry never sends the same message twice.
const seen = $getWorkflowStaticData('global');
seen.deliveries = seen.deliveries || {};
const now = Date.now();
for (const [id, at] of Object.entries(seen.deliveries)) if (now - at > 86400000) delete seen.deliveries[id];
const duplicate = Boolean(seen.deliveries[deliveryId]);
seen.deliveries[deliveryId] = now;

return [{ json: { valid: true, duplicate, event } }];`;

const COMPOSE_NOTIFICATION = String.raw`
// Only the fields Convex sent are used: recipient name/email, tool name,
// dates, and the other person's first name.
const COPY = {
  'loan.requested': (e) => ({
    subject: e.otherPartyFirstName + ' wants to borrow your ' + e.tool.name,
    text: 'Hi ' + e.recipient.name + ',\n\n' + e.otherPartyFirstName + ' would like to borrow your ' + e.tool.name +
      ' from ' + e.loan.startDate + ' to ' + e.loan.endDate + '.\nApprove or decline it under Incoming requests in LendLoop.',
  }),
  'loan.approved': (e) => ({
    subject: 'Approved: ' + e.tool.name,
    text: 'Hi ' + e.recipient.name + ',\n\n' + e.otherPartyFirstName + ' approved your request for the ' + e.tool.name +
      ' (' + e.loan.startDate + ' to ' + e.loan.endDate + '). Please return it by ' + e.loan.endDate + '.',
  }),
  'loan.declined': (e) => ({
    subject: 'Not this time: ' + e.tool.name,
    text: 'Hi ' + e.recipient.name + ',\n\nYour request for the ' + e.tool.name + ' (' + e.loan.startDate +
      ' to ' + e.loan.endDate + ') was declined or cancelled. Other tools are on the board.',
  }),
  'loan.returned': (e) => ({
    subject: 'Returned: ' + e.tool.name,
    text: 'Hi ' + e.recipient.name + ',\n\n' + e.otherPartyFirstName + ' marked the ' + e.tool.name + ' as returned. Thanks for borrowing!',
  }),
};
return $input.all().map((item) => {
  const e = item.json.event;
  const copy = (COPY[e.event] || COPY['loan.declined'])(e);
  return { json: {
    to: e.recipient.email,
    subject: copy.subject,
    text: copy.text,
    writeBack: { idempotencyKey: 'notification:' + e.deliveryId, loanId: e.loanId, kind: 'request_notification' },
  } };
});`;

// The channel is a logged mock, which the brief allows: the message is
// visible in the execution data and the n8n log. For real delivery, swap
// this node for an Email (SMTP) or Slack node that uses an n8n credential;
// the wiring around it (retries, error output, write-back) stays the same.
const MOCK_SEND = String.raw`
return $input.all().map((item) => {
  console.log('[LendLoop notification] to=' + item.json.to + ' subject=' + JSON.stringify(item.json.subject));
  return { json: { ...item.json, channel: 'log' } };
});`;

const MARK = (status) => String.raw`
return $input.all().map((item, i) => {
  // Both outputs of the send step carry the composed item through; fall
  // back to the paired input in case a replacement node does not.
  const src = item.json.writeBack ? item.json : $('Compose message').itemMatching(i).json;
  const err = item.json.error ? String(item.json.error.message || item.json.error).slice(0, 200) : undefined;
  return { json: { writeBack: { ...src.writeBack, status: '${status}', ...(err ? { detail: err } : {}) } } };
});`;

// ── Workflow 2: overdue reminders ─────────────────────────────────────────

const SIGN_FETCH = SIGN_HELPERS + String.raw`
return [{ json: sign('GET', '/n8n/overdue-loans', '') }];`;

const SPLIT_LOANS = String.raw`
const loans = $input.first().json.loans || [];
return loans.map((l) => ({ json: {
  to: l.borrower.email,
  subject: 'Reminder: please return the ' + l.tool.name,
  text: 'Hi ' + l.borrower.name + ',\n\nThe ' + l.tool.name + ' you borrowed from ' + l.lenderFirstName +
    ' was due back on ' + l.endDate + ' (' + l.daysOverdue + ' day' + (l.daysOverdue === 1 ? '' : 's') +
    ' ago). Please return it, or message ' + l.lenderFirstName + ' if you need longer.',
  writeBack: { idempotencyKey: l.reminderKey, loanId: l.loanId, kind: 'overdue_reminder' },
} }));`;

// ── Workflow 3: error workflow ────────────────────────────────────────────

const FORMAT_ERROR = String.raw`
const e = $input.first().json;
const summary = {
  workflow: e.workflow && e.workflow.name,
  executionId: e.execution && e.execution.id,
  url: e.execution && e.execution.url,
  failedNode: e.execution && e.execution.lastNodeExecuted,
  message: e.execution && e.execution.error && e.execution.error.message,
  at: new Date().toISOString(),
};
// Visible in the n8n execution list and container logs. Swap or extend with
// a Slack/Email node to page someone.
console.error('[LendLoop automation failed] ' + JSON.stringify(summary));
return [{ json: summary }];`;

// ── Node builders ─────────────────────────────────────────────────────────

// Stable UUID-shaped ids, so regenerating the exports gives clean diffs.
let seq = 0;
const id = (p) => {
  const h = createHash("sha1").update(`${p}:${++seq}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const code = (name, jsCode, position, extra = {}) => ({
  parameters: { jsCode: jsCode.trim() },
  id: id("c0de0000"),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  ...extra,
});

const ifTrue = (name, field, position) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: id("1f000000"),
          leftValue: `={{ $json.${field} }}`,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
  id: id("1f000000"),
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position,
});

const signedHttp = (name, method, path, position, bodyExpr) => ({
  parameters: {
    method,
    url: `={{ $env.CONVEX_SITE_URL }}${path}`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "X-LendLoop-Timestamp", value: "={{ $json.timestamp }}" },
        { name: "X-LendLoop-Signature", value: "={{ $json.signature }}" },
      ],
    },
    ...(bodyExpr
      ? { sendBody: true, contentType: "raw", rawContentType: "application/json", body: bodyExpr }
      : {}),
    options: { timeout: 10000 },
  },
  id: id("4770000"),
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position,
  // Transient failures retry here; a run that still fails reaches the
  // error workflow instead of failing silently.
  retryOnFail: true,
  maxTries: 5,
  waitBetweenTries: 5000,
});

const respond = (name, code, position) => ({
  parameters: {
    respondWith: "json",
    responseBody: code === 200 ? '={{ { "ok": true } }}' : '={{ { "error": "invalid signature" } }}',
    options: { responseCode: code },
  },
  id: id("7e5b0000"),
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position,
});

const link = (to, index = 0) => ({ node: to, type: "main", index });

function workflow(name, wid, nodes, connections, extraSettings = {}) {
  return {
    name,
    id: wid,
    active: false,
    nodes,
    connections,
    settings: { executionOrder: "v1", ...extraSettings },
    pinData: {},
    tags: [],
  };
}

// Notifications ---------------------------------------------------------------
const notifications = workflow(
  "LendLoop · Loan request notifications",
  "LendLoopNotify01",
  [
    {
      parameters: {
        httpMethod: "POST",
        path: "lendloop-loan-events",
        responseMode: "responseNode",
        options: { rawBody: true },
      },
      id: id("3eb00000"),
      name: "Loan event from Convex",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 300],
      webhookId: "6b1f7c2a-3d4e-4f50-8a61-7b8c9d0e1f20",
    },
    code("Verify signature", VERIFY_WEBHOOK, [220, 300]),
    ifTrue("Signature valid?", "valid", [440, 300]),
    respond("Reject (401)", 401, [660, 460]),
    respond("Accept (200)", 200, [660, 200]),
    { ...ifTrue("Already handled?", "duplicate", [880, 200]) },
    code("Compose message", COMPOSE_NOTIFICATION, [1100, 280]),
    code("Send notification", MOCK_SEND, [1320, 280], { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: "continueErrorOutput" }),
    code("Mark sent", MARK("sent"), [1760, 240]),
    code("Mark failed", MARK("failed"), [1760, 440]),
    code("Sign write-back", SIGN_WRITE_BACK, [1980, 300]),
    signedHttp("Write back to Convex", "POST", "/n8n/automation-events", [2200, 300], "={{ $json.body }}"),
  ],
  {
    "Loan event from Convex": { main: [[link("Verify signature")]] },
    "Verify signature": { main: [[link("Signature valid?")]] },
    "Signature valid?": { main: [[link("Accept (200)")], [link("Reject (401)")]] },
    "Accept (200)": { main: [[link("Already handled?")]] },
    // true = duplicate delivery: stop here.
    "Already handled?": { main: [[], [link("Compose message")]] },
    "Compose message": { main: [[link("Send notification")]] },
    // Output 0 = sent, output 1 = still failing after retries.
    "Send notification": { main: [[link("Mark sent")], [link("Mark failed")]] },
    "Mark sent": { main: [[link("Sign write-back")]] },
    "Mark failed": { main: [[link("Sign write-back")]] },
    "Sign write-back": { main: [[link("Write back to Convex")]] },
  },
  { errorWorkflow: ERROR_WORKFLOW_ID },
);

// Reminders --------------------------------------------------------------------
const reminders = workflow(
  "LendLoop · Daily overdue reminders",
  "LendLoopRemind01",
  [
    {
      parameters: { rule: { interval: [{ field: "days", triggerAtHour: 9 }] } },
      id: id("5c4e0000"),
      name: "Every day at 09:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 300],
    },
    code("Sign fetch", SIGN_FETCH, [220, 300]),
    signedHttp("Fetch overdue loans", "GET", "/n8n/overdue-loans", [440, 300]),
    code("One item per loan", SPLIT_LOANS, [660, 300]),
    { ...code("Compose message", "return $input.all();", [880, 300]) },
    code("Send notification", MOCK_SEND, [1100, 300], { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: "continueErrorOutput" }),
    code("Mark sent", MARK("sent"), [1540, 260]),
    code("Mark failed", MARK("failed"), [1540, 460]),
    code("Sign write-back", SIGN_WRITE_BACK, [1760, 300]),
    signedHttp("Write back to Convex", "POST", "/n8n/automation-events", [1980, 300], "={{ $json.body }}"),
  ],
  {
    "Every day at 09:00": { main: [[link("Sign fetch")]] },
    "Sign fetch": { main: [[link("Fetch overdue loans")]] },
    "Fetch overdue loans": { main: [[link("One item per loan")]] },
    "One item per loan": { main: [[link("Compose message")]] },
    "Compose message": { main: [[link("Send notification")]] },
    // Output 0 = sent, output 1 = still failing after retries.
    "Send notification": { main: [[link("Mark sent")], [link("Mark failed")]] },
    "Mark sent": { main: [[link("Sign write-back")]] },
    "Mark failed": { main: [[link("Sign write-back")]] },
    "Sign write-back": { main: [[link("Write back to Convex")]] },
  },
  { errorWorkflow: ERROR_WORKFLOW_ID },
);

// Errors -----------------------------------------------------------------------
const errors = workflow(
  "LendLoop · Automation errors",
  ERROR_WORKFLOW_ID,
  [
    {
      parameters: {},
      id: id("e7700000"),
      name: "When a LendLoop workflow fails",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 300],
    },
    code("Log the failure", FORMAT_ERROR, [240, 300]),
  ],
  { "When a LendLoop workflow fails": { main: [[link("Log the failure")]] } },
);

const out = new URL("../n8n/workflows/", import.meta.url);
for (const [file, wf] of [
  ["01-loan-request-notifications.json", notifications],
  ["02-daily-overdue-reminders.json", reminders],
  ["03-automation-errors.json", errors],
]) {
  writeFileSync(new URL(file, out), JSON.stringify(wf, null, 2) + "\n");
  console.log("wrote", file);
}

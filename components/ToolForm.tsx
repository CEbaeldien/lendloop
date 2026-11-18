"use client";

import { useState } from "react";
import { CATEGORY_KEYS, CATEGORY_LABELS, CONDITION_KEYS, CONDITION_LABELS, errorMessage } from "@/lib/format";
import { ErrorText, useAction } from "./bits";

export type ToolFields = {
  name: string;
  category: string;
  condition: string;
  description: string;
};

const EMPTY: ToolFields = { name: "", category: "power_tools", condition: "good", description: "" };

export default function ToolForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ToolFields;
  submitLabel: string;
  onSubmit: (f: ToolFields) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<ToolFields>(initial);
  const { busy, error, run } = useAction();

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => onSubmit(f), errorMessage);
        if (ok && !onCancel) setF(EMPTY);
      }}
    >
      <div className="sm:col-span-2">
        <label className="label" htmlFor="tool-name">Name</label>
        <input id="tool-name" className="field" required minLength={2} maxLength={80} value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Cordless drill" />
      </div>
      <div>
        <label className="label" htmlFor="tool-category">Category</label>
        <select id="tool-category" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {CATEGORY_KEYS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tool-condition">Condition</label>
        <select id="tool-condition" className="field" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
          {CONDITION_KEYS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="tool-desc">Short description</label>
        <textarea id="tool-desc" className="field" rows={2} maxLength={500} value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What's included, anything to know" />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="sm:col-span-2"><ErrorText message={error} /></div>
    </form>
  );
}

"use client";
// Small generic create/edit form for the admin console. The server action does all
// validation; this only collects values and shows the result.
import { useState, useTransition } from "react";
import type { Result } from "@/lib/errors";

export type Field =
  | { name: string; label: string; type: "text" | "number"; step?: string; placeholder?: string; required?: boolean }
  | { name: string; label: string; type: "checkbox" }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[] };

type Values = Record<string, string | boolean>;

export function EntityForm({ id, fields, initial, save, submitLabel, compact }: {
  id: string | null;
  fields: Field[];
  initial: Values;
  save: (id: string | null, values: Values) => Promise<Result<null>>;
  submitLabel: string;
  compact?: boolean;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await save(id, values);
      if (!r.ok) return setMsg({ ok: false, text: r.error.message });
      setMsg({ ok: true, text: "Saved" });
      if (id === null) setValues(initial); // ready for the next new record
    });
  };

  return (
    <form onSubmit={submit} className={compact ? "row compact" : "stack"}>
      <div className="row">
        {fields.map((f) => (
          <label key={f.name} className={f.type === "checkbox" ? "check" : ""}>
            {f.label}
            {f.type === "checkbox" ? (
              <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
            ) : f.type === "select" ? (
              <select value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type} step={f.step} placeholder={f.placeholder} required={f.required}
                     inputMode={f.type === "number" ? "decimal" : undefined}
                     value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      <div className="row">
        <button disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "error"}>{msg.text}</span>}
      </div>
    </form>
  );
}

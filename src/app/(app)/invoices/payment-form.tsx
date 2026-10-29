"use client";
import { useState, useTransition } from "react";
import { recordPaymentAction } from "@/app/actions/orders";
import { PAYMENT_METHODS } from "@/lib/domain";

const LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash", bank_transfer: "Bank transfer", upi: "UPI", cheque: "Cheque",
};

export function PaymentForm({ customers }: { customers: { id: string; name: string; due: number }[] }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("upi");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID()); // one key per submission attempt
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const selected = customers.find((c) => c.id === customerId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await recordPaymentAction({ customer_id: customerId, amount, method, reference, idempotency_key: key });
      if (!r.ok) {
        setMsg({ ok: false, text: r.error.message });
        if (r.error.code !== "INTERNAL") setKey(crypto.randomUUID());
        return;
      }
      setMsg({ ok: true, text: "Payment recorded." });
      setAmount(""); setReference(""); setKey(crypto.randomUUID());
    });
  };

  return (
    <form onSubmit={submit} className="card stack" aria-label="Record payment">
      <h2>Record payment</h2>
      <label>Customer
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name} (due ₹{c.due.toLocaleString("en-IN")})</option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>Amount (₹)
          <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)}
                 placeholder={selected ? String(selected.due) : ""} />
        </label>
        <label>Method
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABEL[m]}</option>)}
          </select>
        </label>
        <label>Reference (UTR / cheque no.)
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </label>
      </div>
      <button disabled={pending || !customerId}>{pending ? "Saving…" : "Record payment"}</button>
      {msg && <p role="status" className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
    </form>
  );
}

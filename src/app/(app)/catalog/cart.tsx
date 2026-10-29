"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeOrderAction } from "@/app/actions/orders";
import { checkLine } from "@/lib/domain";

export interface CatalogRow {
  product_id: string; sku: string; name: string; unit: string; unit_price: number;
  min_order_qty: number; pack_size: number; warehouse_id: string; available: number;
}

export function Cart({ rows, fixedCustomerId, customers }: {
  rows: CatalogRow[]; fixedCustomerId: string | null; customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState(fixedCustomerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One key per checkout attempt: double-clicks and retries cannot create duplicate orders.
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());

  const key = (r: CatalogRow) => `${r.product_id}:${r.warehouse_id}`;
  const lines = rows.filter((r) => (qty[key(r)] ?? 0) > 0);
  const problems = lines.map((r) => checkLine({ quantity: qty[key(r)] }, r)).filter(Boolean) as string[];
  const total = useMemo(() => lines.reduce((s, r) => s + qty[key(r)] * Number(r.unit_price), 0), [lines, qty]);

  const submit = () => start(async () => {
    setError(null);
    const r = await placeOrderAction({
      customer_id: customerId, idempotency_key: idempotencyKey,
      items: lines.map((l) => ({ product_id: l.product_id, warehouse_id: l.warehouse_id, quantity: qty[key(l)] })),
    });
    if (!r.ok) {
      setError(r.error.message);
      if (r.error.code !== "INTERNAL") setKey(crypto.randomUUID()); // business rejection: new attempt next time
      router.refresh(); // pull fresh availability
      return;
    }
    router.push(`/orders/${r.data.orderId}`);
  });

  return (
    <div className="stack">
      {!fixedCustomerId && (
        <label>Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <div className="grid">
        {rows.map((r) => (
          <article key={key(r)} className="card">
            <h3>{r.name}</h3>
            <p className="muted">{r.sku} · ₹{Number(r.unit_price).toLocaleString("en-IN")}/{r.unit}</p>
            <p className={r.available > 0 ? "" : "error"}>{r.available > 0 ? `${r.available} available` : "Out of stock"}</p>
            <p className="muted">Min {r.min_order_qty} · packs of {r.pack_size}</p>
            <input type="number" inputMode="numeric" min={0} step={r.pack_size} max={r.available}
                   aria-label={`Quantity for ${r.sku}`} disabled={r.available === 0}
                   value={qty[key(r)] ?? ""} onChange={(e) =>
                     setQty((q) => ({ ...q, [key(r)]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
          </article>
        ))}
      </div>
      <div className="checkout">
        <strong>Total ₹{total.toLocaleString("en-IN")}</strong>
        {problems.map((p) => <p key={p} className="error">{p}</p>)}
        {error && <p role="alert" className="error">{error}</p>}
        <button disabled={pending || !lines.length || problems.length > 0 || !customerId} onClick={submit}>
          {pending ? "Placing order…" : "Place order"}
        </button>
      </div>
    </div>
  );
}

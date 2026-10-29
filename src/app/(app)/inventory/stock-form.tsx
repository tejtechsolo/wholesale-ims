"use client";
import { useState, useTransition } from "react";
import { adjustStockAction, receiveStockAction } from "@/app/actions/orders";

export function StockForm({ productId, warehouseId, canReceive, canAdjust }: {
  productId: string; warehouseId: string; canReceive: boolean; canAdjust: boolean;
}) {
  const [mode, setMode] = useState<"receive" | "adjust">(canReceive ? "receive" : "adjust");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const base = { product_id: productId, warehouse_id: warehouseId };
      const r = mode === "receive"
        ? await receiveStockAction({ ...base, quantity: qty, reason })
        : await adjustStockAction({ ...base, delta: qty, reason });
      setMsg(r.ok ? { ok: true, text: `On hand: ${r.data.onHand}` } : { ok: false, text: r.error.message });
      if (r.ok) { setQty(""); setReason(""); }
    });
  };

  return (
    <form onSubmit={submit} className="row compact">
      {canReceive && canAdjust && (
        <select value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="Stock action">
          <option value="receive">Receive</option><option value="adjust">Adjust ±</option>
        </select>
      )}
      <input type="number" required value={qty} onChange={(e) => setQty(e.target.value)}
             placeholder={mode === "receive" ? "Qty" : "±Qty"} aria-label="Quantity" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} required={mode === "adjust"}
             placeholder={mode === "receive" ? "PO / note" : "Reason"} aria-label="Reason" />
      <button disabled={pending}>Save</button>
      {msg && <span role="status" className={msg.ok ? "muted" : "error"}>{msg.text}</span>}
    </form>
  );
}

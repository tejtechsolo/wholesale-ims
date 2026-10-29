"use client";
import { useState, useTransition } from "react";
import { adjustStockAction, receiveStockAction, setReorderLevelAction, transferStockAction } from "@/app/actions/orders";

type Mode = "receive" | "adjust" | "transfer" | "reorder";
const LABEL: Record<Mode, string> = { receive: "Receive", adjust: "Adjust ±", transfer: "Transfer", reorder: "Reorder level" };

export function StockForm({ productId, warehouseId, reorderLevel, warehouses, canReceive, canAdjust }: {
  productId: string; warehouseId: string; reorderLevel: number;
  warehouses: { id: string; code: string }[]; canReceive: boolean; canAdjust: boolean;
}) {
  // warehouse staff: receive + transfer; manager/admin: everything
  const modes = (["receive", "transfer", "adjust", "reorder"] as Mode[]).filter((m) =>
    m === "receive" || m === "transfer" ? canReceive : canAdjust);
  const destinations = warehouses.filter((w) => w.id !== warehouseId);
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [to, setTo] = useState(destinations[0]?.id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const base = { product_id: productId, warehouse_id: warehouseId };
      const r =
        mode === "receive" ? await receiveStockAction({ ...base, quantity: qty, reason })
        : mode === "adjust" ? await adjustStockAction({ ...base, delta: qty, reason })
        : mode === "transfer" ? await transferStockAction({
            product_id: productId, from_warehouse_id: warehouseId, to_warehouse_id: to, quantity: qty, reason })
        : await setReorderLevelAction({ ...base, level: qty });
      if (!r.ok) return setMsg({ ok: false, text: r.error.message });
      setMsg({ ok: true, text: r.data && "onHand" in r.data ? `On hand: ${r.data.onHand}` : "Saved" });
      setQty(""); setReason("");
    });
  };

  return (
    <form onSubmit={submit} className="row compact">
      {modes.length > 1 && (
        <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setMsg(null); }} aria-label="Stock action">
          {modes.map((m) => <option key={m} value={m}>{LABEL[m]}</option>)}
        </select>
      )}
      {mode === "transfer" && (
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destination warehouse" required>
          {destinations.map((w) => <option key={w.id} value={w.id}>→ {w.code}</option>)}
        </select>
      )}
      <input type="number" required value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity"
             min={mode === "adjust" ? undefined : mode === "reorder" ? 0 : 1}
             placeholder={mode === "adjust" ? "±Qty" : mode === "reorder" ? `Now ${reorderLevel}` : "Qty"} />
      {mode !== "reorder" && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} required={mode === "adjust"}
               placeholder={mode === "adjust" ? "Reason" : "Note"} aria-label="Reason" />
      )}
      <button disabled={pending || (mode === "transfer" && !to)}>Save</button>
      {msg && <span role="status" className={msg.ok ? "muted" : "error"}>{msg.text}</span>}
    </form>
  );
}

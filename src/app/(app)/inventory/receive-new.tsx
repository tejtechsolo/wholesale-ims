"use client";
// Goods-in for any product/warehouse pair, including products with no stock row yet
// (receive_stock upserts the inventory row).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiveStockAction } from "@/app/actions/orders";

export function ReceiveNew({ products, warehouses }: {
  products: { id: string; sku: string; name: string }[];
  warehouses: { id: string; code: string }[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await receiveStockAction({ product_id: productId, warehouse_id: warehouseId, quantity: qty, reason });
      if (!r.ok) return setMsg({ ok: false, text: r.error.message });
      setMsg({ ok: true, text: `Received. On hand: ${r.data.onHand}` });
      setQty(""); setReason("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="card stack" aria-label="Receive stock">
      <h2>Receive stock</h2>
      <div className="row">
        <label>Product
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </select>
        </label>
        <label>Warehouse
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </select>
        </label>
        <label>Quantity<input type="number" min={1} required value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>PO / note<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <div className="row">
        <button disabled={pending || !productId || !warehouseId}>{pending ? "Saving…" : "Receive"}</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "error"}>{msg.text}</span>}
      </div>
    </form>
  );
}

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StockForm } from "./stock-form";
import { ReceiveNew } from "./receive-new";

export default async function InventoryPage() {
  const viewer = await requireRole("warehouse", "manager", "admin", "sales");
  const supabase = await createClient();
  const [inv, low, wh, prods] = await Promise.all([
    supabase.from("inventory")
      .select("product_id, warehouse_id, on_hand, reserved, reorder_level, products(sku, name), warehouses(code)")
      .order("product_id"),
    supabase.rpc("low_stock_report"),
    supabase.from("warehouses").select("id, code").eq("active", true).order("code"),
    supabase.from("products").select("id, sku, name").eq("active", true).order("sku"),
  ]);
  if (inv.error || low.error || wh.error || prods.error) throw new Error("Could not load inventory");
  const canReceive = ["warehouse", "manager", "admin"].includes(viewer.role);
  const canAdjust = ["manager", "admin"].includes(viewer.role);

  return (
    <section className="stack">
      <h1>Inventory</h1>

      {canReceive && <ReceiveNew products={prods.data} warehouses={wh.data} />}

      {low.data.length > 0 && (
        <div className="card" role="region" aria-label="Low stock">
          <h2>Low stock ({low.data.length})</h2>
          <ul>
            {low.data.map((r: any) => (
              <li key={`${r.product_id}:${r.warehouse_id}`}>
                <strong>{r.sku}</strong> at {r.warehouse_code}: {r.available} available,
                reorder level {r.reorder_level} <span className="error">(short {r.shortfall})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="responsive">
        <thead><tr><th>SKU</th><th>Warehouse</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Reorder</th><th></th></tr></thead>
        <tbody>
          {inv.data.map((r: any) => {
            const available = r.on_hand - r.reserved;
            return (
              <tr key={`${r.product_id}:${r.warehouse_id}`}
                  className={r.reorder_level > 0 && available <= r.reorder_level ? "low" : ""}>
                <td data-label="SKU">{r.products.sku}<br /><span className="muted">{r.products.name}</span></td>
                <td data-label="Warehouse">{r.warehouses.code}</td>
                <td data-label="On hand">{r.on_hand}</td>
                <td data-label="Reserved">{r.reserved}</td>
                <td data-label="Available">{available}</td>
                <td data-label="Reorder">{r.reorder_level}</td>
                <td data-label="">
                  {(canReceive || canAdjust) && (
                    <StockForm productId={r.product_id} warehouseId={r.warehouse_id}
                               reorderLevel={r.reorder_level} warehouses={wh.data}
                               canReceive={canReceive} canAdjust={canAdjust} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

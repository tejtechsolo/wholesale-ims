import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StockForm } from "./stock-form";

export default async function InventoryPage() {
  const viewer = await requireRole("warehouse", "manager", "admin", "sales");
  const supabase = await createClient();
  const { data, error } = await supabase.from("inventory")
    .select("product_id, warehouse_id, on_hand, reserved, reorder_level, products(sku, name), warehouses(code)")
    .order("product_id");
  if (error) throw new Error("Could not load inventory");
  const canReceive = ["warehouse", "manager", "admin"].includes(viewer.role);
  const canAdjust = ["manager", "admin"].includes(viewer.role);
  return (
    <section>
      <h1>Inventory</h1>
      <table className="responsive">
        <thead><tr><th>SKU</th><th>Warehouse</th><th>On hand</th><th>Reserved</th><th>Available</th><th></th></tr></thead>
        <tbody>
          {data.map((r: any) => {
            const available = r.on_hand - r.reserved;
            return (
              <tr key={`${r.product_id}:${r.warehouse_id}`} className={available <= r.reorder_level ? "low" : ""}>
                <td data-label="SKU">{r.products.sku}<br /><span className="muted">{r.products.name}</span></td>
                <td data-label="Warehouse">{r.warehouses.code}</td>
                <td data-label="On hand">{r.on_hand}</td>
                <td data-label="Reserved">{r.reserved}</td>
                <td data-label="Available">{available}</td>
                <td data-label="">
                  {(canReceive || canAdjust) && (
                    <StockForm productId={r.product_id} warehouseId={r.warehouse_id}
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

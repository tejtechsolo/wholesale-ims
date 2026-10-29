import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { nextActions, type OrderStatus } from "@/lib/domain";
import { OrderActions } from "./order-actions";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders")
    .select("id, order_number, status, total, notes, created_at, customers(name), order_items(quantity, unit_price, products(sku, name))")
    .eq("id", id).maybeSingle();
  if (!order) notFound(); // also what another customer sees: RLS hides it

  const actions = nextActions(order.status as OrderStatus, viewer.role);
  return (
    <section className="stack">
      <h1>{order.order_number} <span className={`badge ${order.status}`}>{order.status}</span></h1>
      <p className="muted">{(order as any).customers?.name}</p>
      <table className="responsive">
        <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Price</th><th>Line total</th></tr></thead>
        <tbody>
          {(order as any).order_items.map((l: any) => (
            <tr key={l.products.sku}>
              <td data-label="SKU">{l.products.sku}</td>
              <td data-label="Product">{l.products.name}</td>
              <td data-label="Qty">{l.quantity}</td>
              <td data-label="Price">₹{Number(l.unit_price).toLocaleString("en-IN")}</td>
              <td data-label="Line total">₹{(l.quantity * Number(l.unit_price)).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><strong>Total: ₹{Number(order.total).toLocaleString("en-IN")}</strong></p>
      {actions.length > 0 && <OrderActions orderId={order.id} actions={actions} />}
    </section>
  );
}

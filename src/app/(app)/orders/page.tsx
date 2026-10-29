import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  await requireRole();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("orders")
    .select("id, order_number, status, total, created_at, customers(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.status) q = q.eq("status", sp.status);
  const { data: orders, error, count } = await q; // RLS limits buyers to their own orders
  if (error) throw new Error("Could not load orders"); // caught by error.tsx

  return (
    <section>
      <h1>Orders</h1>
      {orders.length === 0 ? <p className="muted">No orders yet.</p> : (
        <table className="responsive">
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
          <tbody>
            {orders.map((o: any) => (
              <tr key={o.id}>
                <td data-label="Order"><Link href={`/orders/${o.id}`}>{o.order_number}</Link></td>
                <td data-label="Customer">{o.customers?.name}</td>
                <td data-label="Status"><span className={`badge ${o.status}`}>{o.status}</span></td>
                <td data-label="Total">₹{Number(o.total).toLocaleString("en-IN")}</td>
                <td data-label="Date">{new Date(o.created_at).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">Page {page} of {Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))}</p>
    </section>
  );
}

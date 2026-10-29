import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaymentForm } from "./payment-form";

const inr = (n: number | string) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const viewer = await requireRole("customer", "sales", "manager", "admin");
  const { status } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("invoices")
    .select("id, invoice_number, amount, amount_paid, status, issued_at, due_date, customer_id, customers(name), orders(order_number)")
    .order("due_date", { ascending: true }).limit(200);
  if (status === "open" || status === "paid") q = q.eq("status", status);
  const { data: invoices, error } = await q; // RLS: buyers only see their own account
  if (error) throw new Error("Could not load invoices");

  const today = todayIST();
  const canRecord = viewer.role === "manager" || viewer.role === "admin";
  // Balance due per customer, for the payment form.
  const due = new Map<string, { name: string; due: number }>();
  for (const i of invoices as any[]) {
    if (i.status !== "open") continue;
    const cur = due.get(i.customer_id) ?? { name: i.customers?.name ?? "", due: 0 };
    cur.due += Number(i.amount) - Number(i.amount_paid);
    due.set(i.customer_id, cur);
  }
  const totalDue = [...due.values()].reduce((s, c) => s + c.due, 0);

  return (
    <section className="stack">
      <h1>Invoices</h1>
      <p className="row">
        <a href="/invoices">All</a> · <a href="/invoices?status=open">Open</a> · <a href="/invoices?status=paid">Paid</a>
        <span className="muted">Total due: <strong>{inr(totalDue)}</strong></span>
      </p>

      {canRecord && due.size > 0 && (
        <PaymentForm customers={[...due].map(([id, c]) => ({ id, name: c.name, due: c.due }))} />
      )}

      {invoices.length === 0 ? <p className="muted">No invoices yet. Invoices are issued when an order ships.</p> : (
        <table className="responsive">
          <thead><tr><th>Invoice</th><th>Order</th><th>Customer</th><th>Amount</th><th>Paid</th><th>Due date</th><th>Status</th></tr></thead>
          <tbody>
            {(invoices as any[]).map((i) => {
              const overdue = i.status === "open" && i.due_date < today;
              return (
                <tr key={i.id} className={overdue ? "low" : ""}>
                  <td data-label="Invoice">{i.invoice_number}</td>
                  <td data-label="Order">{i.orders?.order_number}</td>
                  <td data-label="Customer">{i.customers?.name}</td>
                  <td data-label="Amount">{inr(i.amount)}</td>
                  <td data-label="Paid">{inr(i.amount_paid)}</td>
                  <td data-label="Due date">{new Date(i.due_date + "T00:00:00").toLocaleDateString("en-IN")}</td>
                  <td data-label="Status">
                    <span className={`badge ${i.status === "paid" ? "delivered" : overdue ? "cancelled" : ""}`}>
                      {overdue ? "overdue" : i.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

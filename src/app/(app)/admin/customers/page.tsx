import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveCustomer } from "@/app/actions/admin";
import { EntityForm, type Field } from "../entity-form";

const FIELDS: Field[] = [
  { name: "name", label: "Business name", type: "text", required: true },
  { name: "gstin", label: "GSTIN", type: "text", placeholder: "08ABCDE1234F1Z5" },
  { name: "credit_limit", label: "Credit limit (₹)", type: "number", step: "0.01", required: true },
  { name: "payment_terms_days", label: "Payment terms (days)", type: "number", step: "1", required: true },
  { name: "active", label: "Active", type: "checkbox" },
];
const inr = (n: number | string) => `₹${Number(n).toLocaleString("en-IN")}`;

export default async function CustomersAdmin() {
  await requireRole("manager", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers")
    .select("id, name, gstin, credit_limit, outstanding, payment_terms_days, active").order("name");
  if (error) throw new Error("Could not load customers");
  return (
    <section className="stack">
      <h1>Customers</h1>
      <div className="card">
        <h2>New customer</h2>
        <EntityForm id={null} fields={FIELDS.filter((f) => f.name !== "active")} save={saveCustomer}
          submitLabel="Add customer"
          initial={{ name: "", gstin: "", credit_limit: "0", payment_terms_days: "30", active: true }} />
      </div>
      {data.map((c) => (
        <article key={c.id} className="card" aria-label={`Customer ${c.name}`}>
          <p className="muted">Outstanding {inr(c.outstanding)} of {inr(c.credit_limit)} limit</p>
          <EntityForm id={c.id} fields={FIELDS} save={saveCustomer} submitLabel="Save" compact
            initial={{ name: c.name, gstin: c.gstin ?? "", credit_limit: String(c.credit_limit),
                       payment_terms_days: String(c.payment_terms_days), active: c.active }} />
        </article>
      ))}
    </section>
  );
}

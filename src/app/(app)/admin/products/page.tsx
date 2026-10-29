import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveProduct } from "@/app/actions/admin";
import { EntityForm, type Field } from "../entity-form";

const FIELDS: Field[] = [
  { name: "sku", label: "SKU", type: "text", required: true, placeholder: "RICE-25KG" },
  { name: "name", label: "Name", type: "text", required: true },
  { name: "unit", label: "Unit", type: "text", required: true, placeholder: "bag" },
  { name: "unit_price", label: "Price (₹)", type: "number", step: "0.01", required: true },
  { name: "min_order_qty", label: "Min qty", type: "number", step: "1", required: true },
  { name: "pack_size", label: "Pack size", type: "number", step: "1", required: true },
  { name: "active", label: "Active", type: "checkbox" },
];

export default async function ProductsAdmin() {
  await requireRole("manager", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.from("products")
    .select("id, sku, name, unit, unit_price, min_order_qty, pack_size, active").order("sku");
  if (error) throw new Error("Could not load products");
  return (
    <section className="stack">
      <h1>Products</h1>
      <div className="card">
        <h2>New product</h2>
        <EntityForm id={null} fields={FIELDS} save={saveProduct} submitLabel="Add product"
          initial={{ sku: "", name: "", unit: "pcs", unit_price: "", min_order_qty: "1", pack_size: "1", active: true }} />
      </div>
      {data.map((p) => (
        <article key={p.id} className="card" aria-label={`Product ${p.sku}`}>
          <EntityForm id={p.id} fields={FIELDS} save={saveProduct} submitLabel="Save" compact
            initial={{ sku: p.sku, name: p.name, unit: p.unit, unit_price: String(p.unit_price),
                       min_order_qty: String(p.min_order_qty), pack_size: String(p.pack_size), active: p.active }} />
        </article>
      ))}
    </section>
  );
}

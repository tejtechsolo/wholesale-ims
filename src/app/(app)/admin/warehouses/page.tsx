import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveWarehouse } from "@/app/actions/admin";
import { EntityForm, type Field } from "../entity-form";

const FIELDS: Field[] = [
  { name: "code", label: "Code", type: "text", required: true, placeholder: "JAI-02" },
  { name: "name", label: "Name", type: "text", required: true },
];

// saveWarehouse takes `active` separately; wrap it so the shared form can pass it through.
async function save(id: string | null, values: Record<string, string | boolean>) {
  "use server";
  return saveWarehouse(id, { code: values.code, name: values.name }, values.active !== false);
}

export default async function WarehousesAdmin() {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouses").select("id, code, name, active").order("code");
  if (error) throw new Error("Could not load warehouses");
  return (
    <section className="stack">
      <h1>Warehouses</h1>
      <div className="card">
        <h2>New warehouse</h2>
        <EntityForm id={null} fields={FIELDS} save={save} submitLabel="Add warehouse" initial={{ code: "", name: "" }} />
      </div>
      {data.map((w) => (
        <article key={w.id} className="card" aria-label={`Warehouse ${w.code}`}>
          <EntityForm id={w.id} save={save} submitLabel="Save" compact
            fields={[...FIELDS, { name: "active", label: "Active", type: "checkbox" }]}
            initial={{ code: w.code, name: w.name, active: w.active }} />
        </article>
      ))}
    </section>
  );
}

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Cart, type CatalogRow } from "./cart";

export default async function CatalogPage() {
  const viewer = await requireRole("customer", "sales", "manager", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_availability");
  if (error) throw new Error("Could not load catalog");
  const { data: customers } = viewer.role === "customer"
    ? { data: null }
    : await supabase.from("customers").select("id, name").eq("active", true).order("name");
  return (
    <section>
      <h1>Catalog</h1>
      <Cart rows={(data ?? []) as CatalogRow[]} fixedCustomerId={viewer.customerId}
            customers={customers ?? []} />
    </section>
  );
}

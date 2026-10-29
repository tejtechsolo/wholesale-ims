"use server";
// Admin console actions. Catalog/customer/warehouse writes are plain table writes
// guarded by RLS (manager/admin; warehouses admin only); user changes go through
// SECURITY DEFINER functions. Every action re-checks the role and validates input.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { customerSchema, productSchema, userRoleSchema, warehouseSchema, type Role } from "@/lib/domain";
import { toAppError, type Result } from "@/lib/errors";

async function guard(roles: Role[]) {
  const v = await getViewer();
  if (!v) return toAppError({ code: "P0001", message: "UNAUTHENTICATED" });
  if (v.needsMfa) return toAppError({ code: "P0001", message: "MFA_REQUIRED" });
  if (!roles.includes(v.role)) return toAppError({ code: "P0001", message: "FORBIDDEN" });
  return null;
}
const invalid = (e: z.ZodError): Result<never> =>
  ({ ok: false, error: { code: "VALIDATION", status: 422, message: e.issues[0]?.message ?? "Invalid input." } });
function fail(e: unknown, duplicate?: string): Result<never> {
  const error = toAppError(e);
  if (error.code === "CONFLICT" && duplicate) error.message = duplicate;
  if (error.code === "INTERNAL") console.error("[admin] unexpected error", e);
  return { ok: false, error };
}
const idSchema = z.uuid();

/** Create (no id) or update (id) — one action per entity keeps the client simple. */
export async function saveProduct(id: string | null, input: unknown): Promise<Result<null>> {
  const denied = await guard(["manager", "admin"]); if (denied) return { ok: false, error: denied };
  const p = productSchema.safeParse(input); if (!p.success) return invalid(p.error);
  if (id !== null && !idSchema.safeParse(id).success) return invalid(new z.ZodError([]));
  const supabase = await createClient();
  const q = id
    ? supabase.from("products").update({ ...p.data, updated_at: new Date().toISOString() }).eq("id", id).select("id")
    : supabase.from("products").insert(p.data).select("id");
  const { data, error } = await q;
  if (error) return fail(error, `SKU ${p.data.sku} already exists.`);
  if (!data?.length) return fail({ code: "P0001", message: "FORBIDDEN" }); // RLS filtered the row
  revalidatePath("/admin/products"); revalidatePath("/catalog");
  return { ok: true, data: null };
}

export async function saveCustomer(id: string | null, input: unknown): Promise<Result<null>> {
  const denied = await guard(["manager", "admin"]); if (denied) return { ok: false, error: denied };
  const c = customerSchema.safeParse(input); if (!c.success) return invalid(c.error);
  if (id !== null && !idSchema.safeParse(id).success) return invalid(new z.ZodError([]));
  const row = { ...c.data, gstin: c.data.gstin ?? null };
  const supabase = await createClient();
  // INSERT is only granted on some columns (0003/0005): new accounts start active.
  const { active, ...insertable } = row;
  const q = id
    ? supabase.from("customers").update(row).eq("id", id).select("id")
    : supabase.from("customers").insert(insertable).select("id");
  const { data, error } = await q;
  if (error) return fail(error, "That GSTIN is already registered to another customer.");
  if (!data?.length) return fail({ code: "P0001", message: "FORBIDDEN" });
  revalidatePath("/admin/customers");
  return { ok: true, data: null };
}

export async function saveWarehouse(id: string | null, input: unknown, active = true): Promise<Result<null>> {
  const denied = await guard(["admin"]); if (denied) return { ok: false, error: denied };
  const w = warehouseSchema.safeParse(input); if (!w.success) return invalid(w.error);
  if (id !== null && !idSchema.safeParse(id).success) return invalid(new z.ZodError([]));
  const supabase = await createClient();
  const q = id
    ? supabase.from("warehouses").update({ ...w.data, active: Boolean(active) }).eq("id", id).select("id")
    : supabase.from("warehouses").insert(w.data).select("id");
  const { data, error } = await q;
  if (error) return fail(error, `Warehouse code ${w.data.code} already exists.`);
  if (!data?.length) return fail({ code: "P0001", message: "FORBIDDEN" });
  revalidatePath("/admin/warehouses"); revalidatePath("/inventory");
  return { ok: true, data: null };
}

export async function setUserRole(input: unknown): Promise<Result<null>> {
  const denied = await guard(["admin"]); if (denied) return { ok: false, error: denied };
  const r = userRoleSchema.safeParse(input); if (!r.success) return invalid(r.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_user_id: r.data.user_id, p_role: r.data.role, p_customer_id: r.data.customer_id ?? null,
  });
  if (error) return fail(error);
  revalidatePath("/admin/users");
  return { ok: true, data: null };
}

export async function setUserActive(userId: unknown, active: unknown): Promise<Result<null>> {
  const denied = await guard(["admin"]); if (denied) return { ok: false, error: denied };
  const u = idSchema.safeParse(userId);
  if (!u.success || typeof active !== "boolean") return invalid(new z.ZodError([]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", { p_user_id: u.data, p_active: active });
  if (error) return fail(error);
  revalidatePath("/admin/users");
  return { ok: true, data: null };
}

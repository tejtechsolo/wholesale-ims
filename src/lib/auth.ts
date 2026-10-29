import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Role } from "./domain";

export interface Viewer { id: string; role: Role; customerId: string | null; name: string }

/** Verified user + role from public.profiles (never from user_metadata). Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: p } = await supabase
    .from("profiles").select("id, role, customer_id, full_name, active").eq("id", uid).maybeSingle();
  if (!p || !p.active) return null;
  return { id: p.id, role: p.role, customerId: p.customer_id, name: p.full_name };
});

/** Page/layout guard. Server Actions use requireRoleOrError instead (no redirects). */
export async function requireRole(...roles: Role[]): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (roles.length && !roles.includes(v.role)) redirect("/orders?denied=1");
  return v;
}

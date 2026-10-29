import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { MFA_ROLES, type Role } from "./domain";

export interface Viewer {
  id: string; role: Role; customerId: string | null; name: string;
  /** Authenticator assurance level of this session: aal2 = MFA verified. */
  aal: "aal1" | "aal2";
  /** Role requires MFA and this session hasn't completed it (DB grants nothing until it does). */
  needsMfa: boolean;
}

/** Verified user + role from public.profiles (never from user_metadata). Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: p } = await supabase
    .from("profiles").select("id, role, customer_id, full_name, active").eq("id", uid).maybeSingle();
  if (!p || !p.active) return null;
  const aal = data.claims.aal === "aal2" ? "aal2" : "aal1";
  return {
    id: p.id, role: p.role, customerId: p.customer_id, name: p.full_name, aal,
    needsMfa: MFA_ROLES.includes(p.role) && aal !== "aal2",
  };
});

/** Signed in with an active profile; MFA NOT required (layout, password and MFA pages). */
export async function requireSession(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

/** Page guard: signed in, allowed role, and MFA completed where the role requires it. */
export async function requireRole(...roles: Role[]): Promise<Viewer> {
  const v = await requireSession();
  if (v.needsMfa) redirect("/account/mfa");
  if (roles.length && !roles.includes(v.role)) redirect("/orders?denied=1");
  return v;
}

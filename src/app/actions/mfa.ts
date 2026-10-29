"use server";
// TOTP enrolment and verification. Factor ids are always looked up server-side from the
// user's own factors; the client only ever sends a 6-digit code.
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { MFA_ROLES } from "@/lib/domain";

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your app");
const safeNext = (raw: unknown) => {
  const n = typeof raw === "string" ? raw : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/account/mfa") ? n : "/orders";
};

export interface Enrollment { qr: string; secret: string }

/** Starts (or restarts) TOTP enrolment. Removes abandoned unverified factors first. */
export async function startEnrollment(): Promise<{ ok: true; data: Enrollment } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Please sign in again." };
  if (!MFA_ROLES.includes(viewer.role)) return { ok: false, error: "Two-factor is only used for admin and manager accounts." };
  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { ok: false, error: "Could not start setup. Try again." };
  if (factors.totp.length > 0) return { ok: false, error: "Two-factor is already set up for this account." };
  for (const f of factors.all.filter((f) => f.factor_type === "totp" && f.status !== "verified"))
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp", issuer: "Wholesale IMS", friendlyName: `Authenticator ${new Date().toISOString()}`,
  });
  if (error) return { ok: false, error: "Could not start setup. Try again." };
  return { ok: true, data: { qr: data.totp.qr_code, secret: data.totp.secret } };
}

/** Verifies a code: finishes enrolment, or completes the sign-in challenge (→ aal2). */
export async function verifyCode(_prev: { error?: string } | undefined, form: FormData) {
  const code = codeSchema.safeParse(form.get("code"));
  if (!code.success) return { error: code.error.issues[0].message };
  if (!(await getViewer())) return { error: "Please sign in again." };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  // Prefer a verified factor (sign-in challenge); otherwise the pending enrolment.
  const factor = factors?.totp[0] ?? factors?.all.find((f) => f.factor_type === "totp" && f.status !== "verified");
  if (!factor) return { error: "Set up two-factor first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) return { error: "That code didn't work. Wait for a new code and try again." };
  redirect(safeNext(form.get("next")));
}

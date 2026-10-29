"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { clientIp, throttleKeys } from "@/lib/throttle";
import { MFA_ROLES } from "@/lib/domain";

const schema = z.object({ email: z.email(), password: z.string().min(8).max(128) });

const TOO_MANY = "Too many failed sign-in attempts. Try again in 15 minutes.";

export async function signIn(_prev: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const supabase = await createClient();

  // Throttle failures per (client IP, email) and per client IP. Fails OPEN (logged) if the
  // pepper is missing or the check errors, so an outage never locks everyone out.
  const secret = process.env.LOGIN_THROTTLE_SECRET;
  if (!secret) console.error("[auth] LOGIN_THROTTLE_SECRET is not set: sign-in throttling is OFF");
  const keys = secret ? throttleKeys(parsed.data.email, clientIp(await headers()), secret) : null;
  const throttle = async (event: "check" | "fail" | "success") => {
    if (!keys) return false;
    const { data, error } = await supabase.rpc("login_throttle", { p_pair: keys.pair, p_ip: keys.ip, p_event: event });
    if (error) console.error("[auth] login_throttle failed", error.code);
    return data === true;
  };

  if (await throttle("check")) return { error: TOO_MANY };
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    await throttle("fail");
    // Same message for unknown email / wrong password: no account enumeration.
    return { error: "Invalid email or password." };
  }
  await throttle("success");
  const raw = String(form.get("next") ?? "/orders");
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/orders"; // no open redirect
  // Admins and managers must complete MFA before the database grants them anything.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", signedIn.user.id).maybeSingle();
  if (profile && MFA_ROLES.includes(profile.role)) redirect(`/account/mfa?next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const resetSchema = z.object({ email: z.email() });

/** Always answers the same way: never reveals whether an account exists. */
export async function requestPasswordReset(_prev: { done?: boolean; error?: string } | undefined, form: FormData) {
  const parsed = resetSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) return { error: "Enter a valid email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && error.status !== 400 && error.status !== 404) console.error("[auth] reset failed", error.status);
  return { done: true };
}

const passwordSchema = z.object({
  password: z.string().min(10, "Use at least 10 characters").max(128)
    .regex(/[a-z]/i, "Include a letter").regex(/\d/, "Include a number"),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export async function setPassword(_prev: { error?: string } | undefined, form: FormData) {
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { error: "Your link has expired. Ask for a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.code === "same_password" ? "Choose a different password." : "Could not save the password. Try again." };
  redirect("/orders?password=updated");
}

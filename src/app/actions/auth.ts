"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.email(), password: z.string().min(8).max(128) });

export async function signIn(_prev: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for unknown email / wrong password: no account enumeration.
  if (error) return { error: "Invalid email or password." };
  const next = String(form.get("next") ?? "/orders");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/orders"); // no open redirect
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

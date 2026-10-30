// Supabase connection settings, validated. A missing or placeholder value means the
// deployment isn't connected to a Supabase project yet; callers show a clear
// "not configured" message instead of failing in confusing ways.

const PLACEHOLDER = /YOUR-PROJECT|sb_publishable_xxx|example\.supabase\.co/i;

export interface SupabaseEnv { url: string; key: string }

export function readSupabaseEnv(env: Record<string, string | undefined> = process.env): SupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url || !key || PLACEHOLDER.test(url) || PLACEHOLDER.test(key)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/$/, ""), key };
}

export const NOT_CONFIGURED_MESSAGE =
  "Sign-in isn't available yet: this site isn't connected to its database. (Administrator: set the Supabase environment variables.)";

export type SignInFailure = "invalid_credentials" | "unavailable" | "other";

/** Only a real credentials error may be reported (and counted) as a wrong password. */
export function classifySignInError(error: { code?: string; status?: number; name?: string } | null): SignInFailure | null {
  if (!error) return null;
  if (error.code === "invalid_credentials") return "invalid_credentials";
  // Older Auth servers: 400 without a code means bad email/password.
  if (error.status === 400 && !error.code) return "invalid_credentials";
  if (error.status === 0 || (error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError") return "unavailable";
  return "other";
}

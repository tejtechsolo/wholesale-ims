import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readSupabaseEnv } from "@/lib/env";

/** Per-request Supabase client acting AS the signed-in user (RLS applies). */
export async function createClient() {
  const env = readSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  const cookieStore = await cookies();
  return createServerClient(
    env.url,
    env.key,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}

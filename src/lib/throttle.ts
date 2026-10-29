// Sign-in throttling keys (see supabase/migrations/0007_login_throttle.sql).
import { createHmac } from "node:crypto";

/**
 * Client IP as reported by the hosting proxy. Only trustworthy behind a proxy that
 * overwrites X-Forwarded-For (e.g. Vercel, a load balancer you control).
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Opaque keys: HMAC with a server-only pepper, so nobody can compute a victim's key. */
export function throttleKeys(email: string, ip: string, secret: string) {
  const mac = (v: string) => createHmac("sha256", secret).update(v).digest("hex");
  const e = email.trim().toLowerCase();
  return { pair: mac(`pair|${ip}|${e}`), ip: mac(`ip|${ip}`) };
}

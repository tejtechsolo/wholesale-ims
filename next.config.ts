import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'", `connect-src 'self' ${supabase}`,
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join("; "),
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
};
export default config;

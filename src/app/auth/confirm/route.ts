// Landing point for invite / password-reset emails.
// Email templates link to /auth/confirm?token_hash=…&type=invite|recovery (see
// supabase/templates). verifyOtp turns the one-time token into a session cookie,
// then the user sets a password.
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const ALLOWED: EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fail = (reason: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?error=${reason}`;
    return NextResponse.redirect(url);
  };
  if (!tokenHash || !type || !ALLOWED.includes(type)) return fail("invalid_link");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail("expired_link"); // used or expired: same message, no detail

  const url = request.nextUrl.clone();
  url.pathname = "/account/password";
  url.search = type === "invite" ? "?welcome=1" : "";
  return NextResponse.redirect(url);
}

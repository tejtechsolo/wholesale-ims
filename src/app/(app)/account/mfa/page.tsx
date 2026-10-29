import { requireSession } from "@/lib/auth";
import { MFA_ROLES } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { EnrollForm, ChallengeForm } from "./mfa-forms";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await requireSession(); // session only: this page is how MFA gets completed
  const { next } = await searchParams;
  // Only roles that require MFA are offered it: for other roles the app never asks for a code
  // at sign-in, so an optional factor would give a false sense of security.
  if (!MFA_ROLES.includes(viewer.role))
    return <section className="stack"><h1>Two-factor authentication</h1>
      <p className="muted">Two-factor is used for admin and manager accounts.</p></section>;
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const enrolled = (data?.totp.length ?? 0) > 0;

  return (
    <section className="stack" style={{ maxWidth: 460 }}>
      <h1>Two-factor authentication</h1>
      {viewer.aal === "aal2" ? (
        <p role="status">Two-factor is on and this session is verified.</p>
      ) : enrolled ? (
        <>
          <p className="muted">Enter the 6-digit code from your authenticator app.</p>
          <ChallengeForm next={next ?? "/orders"} />
        </>
      ) : (
        <>
          <p className="muted">
            {viewer.needsMfa ? "Your role requires two-factor authentication. " : ""}
            Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator,
            1Password…), then enter the 6-digit code it shows.
          </p>
          <EnrollForm next={next ?? "/orders"} />
        </>
      )}
    </section>
  );
}

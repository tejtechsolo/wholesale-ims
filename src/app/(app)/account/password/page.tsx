import { requireSession } from "@/lib/auth";
import { PasswordForm } from "./password-form";

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  // Session only: an invited admin sets a password before enrolling MFA.
  const viewer = await requireSession();
  const { welcome } = await searchParams;
  return (
    <section className="stack" style={{ maxWidth: 420 }}>
      <h1>{welcome ? `Welcome, ${viewer.name}` : "Change password"}</h1>
      {welcome && <p className="muted">Set a password to finish setting up your account.</p>}
      <PasswordForm />
    </section>
  );
}

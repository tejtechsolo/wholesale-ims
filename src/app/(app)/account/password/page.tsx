import { requireRole } from "@/lib/auth";
import { PasswordForm } from "./password-form";

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const viewer = await requireRole();
  const { welcome } = await searchParams;
  return (
    <section className="stack" style={{ maxWidth: 420 }}>
      <h1>{welcome ? `Welcome, ${viewer.name}` : "Change password"}</h1>
      {welcome && <p className="muted">Set a password to finish setting up your account.</p>}
      <PasswordForm />
    </section>
  );
}

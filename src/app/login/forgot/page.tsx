import { ForgotForm } from "./forgot-form";

export default function ForgotPage() {
  return (
    <main className="auth">
      <h1>Reset password</h1>
      <p className="muted">We'll email you a link to choose a new password.</p>
      <ForgotForm />
      <p><a href="/login">Back to sign in</a></p>
    </main>
  );
}

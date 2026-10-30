import { LoginForm } from "./login-form";
import { NOT_CONFIGURED_MESSAGE, readSupabaseEnv } from "@/lib/env";

const LINK_ERRORS: Record<string, string> = {
  invalid_link: "That link isn't valid.",
  expired_link: "That link has expired or was already used. Ask for a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="auth">
      <h1>Wholesale IMS</h1>
      <p className="muted">Sign in with the account your administrator created.</p>
      {!readSupabaseEnv() && <p role="alert" className="error">{NOT_CONFIGURED_MESSAGE}</p>}
      {error && LINK_ERRORS[error] && <p role="alert" className="error">{LINK_ERRORS[error]}</p>}
      <LoginForm next={next ?? "/orders"} />
      <p><a href="/login/forgot">Forgot password?</a></p>
    </main>
  );
}

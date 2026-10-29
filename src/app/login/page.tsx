import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="auth">
      <h1>Wholesale IMS</h1>
      <p className="muted">Sign in with the account your administrator created.</p>
      <LoginForm next={next ?? "/orders"} />
    </main>
  );
}

"use client";
import { useActionState } from "react";
import { requestPasswordReset } from "../../actions/auth";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  if (state?.done)
    return <p role="status">If an account exists for that email, a reset link is on its way.</p>;
  return (
    <form action={action} className="stack">
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

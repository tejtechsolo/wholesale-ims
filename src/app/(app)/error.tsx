"use client";
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="stack">
      <h2>Something went wrong</h2>
      <p className="muted">Please try again. If it keeps happening, contact your administrator.</p>
      <button onClick={reset}>Retry</button>
    </div>
  );
}

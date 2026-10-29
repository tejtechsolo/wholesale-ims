"use client";
import { useState, useTransition } from "react";
import { transitionOrderAction } from "@/app/actions/orders";
import type { OrderStatus } from "@/lib/domain";

const LABEL: Record<OrderStatus, string> = {
  submitted: "Submit", approved: "Approve", picking: "Start picking",
  shipped: "Mark shipped", delivered: "Mark delivered", cancelled: "Cancel order",
};

export function OrderActions({ orderId, actions }: { orderId: string; actions: OrderStatus[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (to: OrderStatus) => {
    if (to === "cancelled" && !confirm("Cancel this order? Reserved stock will be released.")) return;
    setError(null);
    start(async () => {
      const r = await transitionOrderAction({ orderId, to });
      if (!r.ok) setError(r.error.message);
    });
  };
  return (
    <div className="stack">
      <div className="row">
        {actions.map((a) => (
          <button key={a} disabled={pending} className={a === "cancelled" ? "danger" : ""} onClick={() => run(a)}>
            {LABEL[a]}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

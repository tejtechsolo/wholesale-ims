"use client";
import { useState, useTransition } from "react";
import { setUserActive, setUserRole } from "@/app/actions/admin";
import { ROLES, type Role } from "@/lib/domain";

interface U { id: string; email: string; full_name: string; role: Role; customer_id: string | null; active: boolean }

export function UserRow({ user, customers, isSelf }: {
  user: U; customers: { id: string; name: string }[]; isSelf: boolean;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const [customerId, setCustomerId] = useState(user.customer_id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error!.message });
  });

  return (
    <tr className={user.active ? "" : "muted"}>
      <td data-label="Name">{user.full_name}{isSelf && " (you)"}</td>
      <td data-label="Email">{user.email}</td>
      <td data-label="Role">
        {isSelf ? role : (
          <div className="row compact">
            <select aria-label={`Role for ${user.email}`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {role === "customer" && (
              <select aria-label="Customer account" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Customer account…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button disabled={pending} onClick={() => run(() => setUserRole({ user_id: user.id, role, customer_id: customerId }))}>
              Save role
            </button>
          </div>
        )}
      </td>
      <td data-label="Status">
        {user.active ? "Active" : "Disabled"}{" "}
        {!isSelf && (
          <button className={user.active ? "danger" : ""} disabled={pending}
                  onClick={() => run(() => setUserActive(user.id, !user.active))}>
            {user.active ? "Disable" : "Enable"}
          </button>
        )}
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "error"}> {msg.text}</span>}
      </td>
    </tr>
  );
}

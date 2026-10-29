import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UserRow } from "./user-row";

export default async function UsersAdmin() {
  const viewer = await requireRole("admin");
  const supabase = await createClient();
  const [users, customers] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
  ]);
  if (users.error || customers.error) throw new Error("Could not load users");
  return (
    <section className="stack">
      <h1>Users</h1>
      <p className="muted">
        New accounts are created with <code>scripts/invite-user.mjs</code> (needs the server secret key);
        the person gets an email to set their password.
      </p>
      <table className="responsive">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {(users.data as any[]).map((u) => (
            <UserRow key={u.id} user={u} customers={customers.data} isSelf={u.id === viewer.id} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { signOut } from "../actions/auth";
import { MFA_ROLES, type Role } from "@/lib/domain";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/catalog", label: "Catalog", roles: ["customer", "sales", "manager", "admin"] },
  { href: "/orders", label: "Orders", roles: ["customer", "sales", "warehouse", "manager", "admin"] },
  { href: "/inventory", label: "Inventory", roles: ["warehouse", "manager", "admin", "sales"] },
  { href: "/invoices", label: "Invoices", roles: ["customer", "sales", "manager", "admin"] },
  { href: "/admin", label: "Admin", roles: ["manager", "admin"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Session only: MFA is enforced per page (requireRole) so /account/mfa itself can render.
  const viewer = await requireSession();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Wholesale IMS</strong>
        <nav aria-label="Main">
          {!viewer.needsMfa && NAV.filter((n) => n.roles.includes(viewer.role)).map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
        <form action={signOut} className="who">
          <span className="muted">{viewer.name} · {viewer.role}</span>
          <Link href="/account/password" className="muted">Password</Link>
          {MFA_ROLES.includes(viewer.role) && <Link href="/account/mfa" className="muted">Two-factor</Link>}
          <button className="ghost">Sign out</button>
        </form>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

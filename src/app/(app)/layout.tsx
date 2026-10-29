import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { signOut } from "../actions/auth";
import type { Role } from "@/lib/domain";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/catalog", label: "Catalog", roles: ["customer", "sales", "manager", "admin"] },
  { href: "/orders", label: "Orders", roles: ["customer", "sales", "warehouse", "manager", "admin"] },
  { href: "/inventory", label: "Inventory", roles: ["warehouse", "manager", "admin", "sales"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireRole();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Wholesale IMS</strong>
        <nav aria-label="Main">
          {NAV.filter((n) => n.roles.includes(viewer.role)).map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
        <form action={signOut} className="who">
          <span className="muted">{viewer.name} · {viewer.role}</span>
          <button className="ghost">Sign out</button>
        </form>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

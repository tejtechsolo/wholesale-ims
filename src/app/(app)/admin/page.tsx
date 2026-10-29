import Link from "next/link";
import { requireRole } from "@/lib/auth";

export default async function AdminHome() {
  const viewer = await requireRole("manager", "admin");
  const links = [
    { href: "/admin/products", label: "Products", desc: "Prices, MOQ, pack sizes, availability" },
    { href: "/admin/customers", label: "Customers", desc: "Accounts, GSTIN, credit limits, payment terms" },
    ...(viewer.role === "admin" ? [
      { href: "/admin/warehouses", label: "Warehouses", desc: "Locations stock can be held in" },
      { href: "/admin/users", label: "Users", desc: "Roles and access" },
    ] : []),
  ];
  return (
    <section className="stack">
      <h1>Admin</h1>
      <div className="grid">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="card"><h3>{l.label}</h3><p className="muted">{l.desc}</p></Link>
        ))}
      </div>
    </section>
  );
}

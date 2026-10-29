import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = { title: "Wholesale IMS", description: "Wholesale inventory & orders" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers forces dynamic rendering, which the CSP nonce requires:
  // a statically prerendered page would ship scripts without this request's nonce.
  await headers();
  return <html lang="en"><body>{children}</body></html>;
}

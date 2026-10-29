import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Wholesale IMS", description: "Wholesale inventory & orders" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

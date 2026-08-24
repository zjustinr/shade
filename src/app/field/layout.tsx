import type { Metadata } from "next";
import { FieldShell } from "./layout-shell";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import "../globals.css";

export const metadata: Metadata = {
  title: "Cool Corners — Field Tool",
  // Crew-only instrument; keep it out of search results entirely.
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cool Corners", statusBarStyle: "default" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately not user-scalable:no — §10 requires 200% zoom to work.
  maximumScale: 5,
  themeColor: "#1f2937",
};

export default function FieldRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <RegisterServiceWorker />
        <FieldShell>{children}</FieldShell>
      </body>
    </html>
  );
}

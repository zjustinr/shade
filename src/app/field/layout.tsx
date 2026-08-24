import type { Metadata } from "next";
import { FieldShell } from "./layout-shell";
import "../globals.css";

export const metadata: Metadata = {
  title: "Cool Corners — Field Tool",
  // Crew-only instrument; keep it out of search results entirely.
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately not user-scalable:no — §10 requires 200% zoom to work.
  maximumScale: 5,
};

export default function FieldRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <FieldShell>{children}</FieldShell>
      </body>
    </html>
  );
}

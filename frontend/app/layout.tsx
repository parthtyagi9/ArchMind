import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecallOps — governed memory for incident response",
  description: "Incident response agent that learns, remembers, and forgets responsibly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

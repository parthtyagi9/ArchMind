import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArchMind — engineering memory you can govern",
  description: "Codebase intelligence, architecture exploration and governed organizational memory for engineering teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}

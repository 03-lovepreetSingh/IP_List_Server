import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IP Feed Server",
  description:
    "Self-hosted plain-text IP feed for nftables / External Dynamic List consumption.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

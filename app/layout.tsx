import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Smart Queue Cafeteria",
  description: "Order from your seat. Skip the line.",
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: {
    default: "Smart Queue Cafeteria",
    template: "%s · Smart Queue Cafeteria",
  },
  description: "Order from your seat. Skip the line.",
  manifest: "/manifest.webmanifest",
  applicationName: "Smart Queue Cafeteria",
  appleWebApp: { capable: true, title: "Smart Queue", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#047857",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="page-bg min-h-screen text-ink-900 antialiased">
        <a
          href="#main"
          className="sr-only-focusable btn btn-primary"
          style={{ position: "absolute", left: 8, top: 8, zIndex: 100 }}
        >
          Skip to main content
        </a>
        <Providers>
          <main id="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

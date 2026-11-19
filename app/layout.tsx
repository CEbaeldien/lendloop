import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import { PwaRuntime } from "@/components/Pwa";

export const metadata: Metadata = {
  title: "LendLoop — Borrow what you need. Lend what you don't.",
  description: "A neighbourhood tool-lending board.",
  applicationName: "LendLoop",
  appleWebApp: { capable: true, title: "LendLoop", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#eef2ea",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
          <PwaRuntime />
        </ClerkProvider>
      </body>
    </html>
  );
}

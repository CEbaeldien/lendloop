import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";

export const metadata: Metadata = {
  title: "LendLoop — Borrow what you need. Lend what you don't.",
  description: "A neighbourhood tool-lending board.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

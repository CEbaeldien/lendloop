import type { MetadataRoute } from "next";

// Web app manifest: makes LendLoop installable from the browser
// (home screen on phones, an app window on desktop). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "LendLoop",
    short_name: "LendLoop",
    description: "Borrow what you need. Lend what you don't.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef2ea",
    theme_color: "#eef2ea",
    categories: ["lifestyle", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

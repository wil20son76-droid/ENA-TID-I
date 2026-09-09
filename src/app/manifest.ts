import type { MetadataRoute } from "next";

// Next.js sirve y enlaza este archivo automáticamente en /manifest.webmanifest
// (convención de archivo de metadatos de App Router, ver IMPLEMENTATION_PLAN.md §7).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mi Piscicultura",
    short_name: "Piscicultura",
    description: "Gestión offline-first de un emprendimiento piscícola.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#047857",
    lang: "es",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

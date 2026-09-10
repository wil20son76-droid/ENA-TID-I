import { ImageResponse } from "next/og";

import { loadBrandLogoDataUri } from "@/lib/server/brandAssets";

// Favicon (convención de archivo de Next.js App Router: "icon.tsx" se
// sirve automáticamente como /icon y se enlaza solo en <head> — sustituye
// al favicon.ico genérico por defecto de create-next-app). Mismo logo
// maestro que /icons/[size] (PWA) y Logo.tsx (login/header); mismo
// fallback al placeholder "P" mientras el logo definitivo no esté en
// public/brand/logo.png.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const logoDataUri = await loadBrandLogoDataUri();

  if (!logoDataUri) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#047857",
            borderRadius: "20%",
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", fontFamily: "sans-serif" }}>P</span>
        </div>
      ),
      size,
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
        }}
      >
        <img src={logoDataUri} alt="" width={32} height={32} style={{ objectFit: "contain" }} />
      </div>
    ),
    size,
  );
}

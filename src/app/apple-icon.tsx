import { ImageResponse } from "next/og";

import { loadBrandLogoDataUri } from "@/lib/server/brandAssets";

// Apple touch icon (convención de archivo: "apple-icon.tsx"). iOS no
// respeta transparencia en este ícono (lo pinta sobre su propia máscara
// redondeada) — por eso, a diferencia del ícono "any" de manifest.ts,
// aquí siempre se rellena con blanco de fondo antes del logo, exista o no
// transparencia en el PNG original.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
          }}
        >
          <span style={{ fontSize: 100, fontWeight: 700, color: "#ffffff", fontFamily: "sans-serif" }}>P</span>
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
        <img src={logoDataUri} alt="" width={180} height={180} style={{ objectFit: "contain" }} />
      </div>
    ),
    size,
  );
}

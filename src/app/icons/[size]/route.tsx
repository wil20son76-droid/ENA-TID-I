import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { loadBrandLogoDataUri } from "@/lib/server/brandAssets";

// Íconos PWA (manifest.ts): 192×192 y 512×512 "any", y una variante
// "512-maskable" con relleno de seguridad (§"icono maskable si
// corresponde" — Android puede recortar un ícono maskable a cualquier
// forma, así que el contenido real debe caber dentro de ~80% del lienzo,
// nunca tocar los bordes). Se generan bajo demanda con next/og en vez de
// depender de binarios de imagen o una librería de redimensionado — una
// vez que el service worker los cachea la primera vez, funcionan igual
// offline.
//
// Con el logo definitivo ya en public/brand/logo.png (ver Logo.tsx),
// estas tres rutas lo leen y lo dibujan preservando proporciones
// (objectFit: "contain", nunca "cover" ni un tamaño fijo que lo deforme).
// Sin el archivo todavía (brandAssets.ts devuelve null), cae al
// placeholder original de la app ("P" sobre fondo verde) — cero cambio de
// comportamiento hasta que el logo real esté presente.
export const dynamic = "force-static";

const SIZE_CONFIGS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "512-maskable": { size: 512, maskable: true },
} as const;

type SizeKey = keyof typeof SIZE_CONFIGS;

function isSupportedSize(value: string): value is SizeKey {
  return value in SIZE_CONFIGS;
}

const BRAND_GREEN = "#047857";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: sizeParam } = await params;

  if (!isSupportedSize(sizeParam)) {
    return NextResponse.json({ error: "Tamaño de ícono no soportado" }, { status: 404 });
  }

  const { size, maskable } = SIZE_CONFIGS[sizeParam];
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
            backgroundColor: BRAND_GREEN,
          }}
        >
          <span
            style={{
              fontSize: size * 0.55,
              fontWeight: 700,
              color: "#ffffff",
              fontFamily: "sans-serif",
            }}
          >
            P
          </span>
        </div>
      ),
      { width: size, height: size },
    );
  }

  // Zona segura maskable: el contenido ocupa ~80% del lienzo, centrado,
  // sobre el color de marca (nunca transparente en un maskable — el
  // sistema operativo rellena el resto de la forma recortada con lo que
  // haya en el fondo, y transparente ahí se ve mal en la práctica).
  const contentSize = maskable ? Math.round(size * 0.8) : size;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: maskable ? BRAND_GREEN : "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og
            (Satori) exige un <img> plano con una fuente ya resuelta
            (data URI), no admite next/image aquí. */}
        <img
          src={logoDataUri}
          alt=""
          width={contentSize}
          height={contentSize}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}

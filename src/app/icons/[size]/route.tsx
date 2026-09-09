import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

// Icono placeholder propio (§60/§76 del encargo: sin diseño definitivo
// todavía). Se genera bajo demanda con next/og en vez de depender de un
// generador de íconos externo o de binarios de imagen — una vez que el
// service worker lo cachea la primera vez, funciona igual offline.
export const dynamic = "force-static";

const SUPPORTED_SIZES = ["192", "512"] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: sizeParam } = await params;

  if (!SUPPORTED_SIZES.includes(sizeParam as (typeof SUPPORTED_SIZES)[number])) {
    return NextResponse.json({ error: "Tamaño de ícono no soportado" }, { status: 404 });
  }

  const size = Number(sizeParam);

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

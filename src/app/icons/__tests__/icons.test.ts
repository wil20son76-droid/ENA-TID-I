// Pruebas de las rutas de íconos PWA/favicon (§"PWA/iconos" — 192×192,
// 512×512, variante maskable, favicon y apple-touch-icon). Sin el logo
// definitivo en public/brand/logo.png en este entorno de test, todas caen
// al placeholder "P" existente (brandAssets.ts devuelve null) — lo que se
// verifica aquí es que cada ruta responde con una imagen PNG válida del
// tamaño correcto y que el manifest apunta a las rutas correctas, no el
// contenido visual exacto (eso requiere el archivo real, ver
// SECURITY.md/README.md para el paso manual pendiente).
import { describe, expect, it } from "vitest";

import manifest from "../../manifest";
import { GET as iconsRouteHandler } from "../[size]/route";
import AppleIconRoute from "../../apple-icon";
import IconRoute from "../../icon";

async function readPngDimensions(response: Response): Promise<{ width: number; height: number }> {
  const buffer = Buffer.from(await response.arrayBuffer());
  // Cabecera PNG: 8 bytes de firma + chunk IHDR (4 bytes de longitud, 4 de
  // tipo "IHDR", luego 4 bytes de ancho y 4 de alto en big-endian) — leer
  // esto directamente evita depender de una librería de imágenes solo
  // para un test.
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe("GET /icons/[size]", () => {
  it.each([
    ["192", 192],
    ["512", 512],
    ["512-maskable", 512],
  ] as const)("responde un PNG de %sx%s para el tamaño \"%s\"", async (sizeParam, expectedSize) => {
    const response = await iconsRouteHandler(new Request("http://localhost/icons/x"), {
      params: Promise.resolve({ size: sizeParam }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    const { width, height } = await readPngDimensions(response);
    expect(width).toBe(expectedSize);
    expect(height).toBe(expectedSize);
  });

  it("responde 404 para un tamaño no soportado", async () => {
    const response = await iconsRouteHandler(new Request("http://localhost/icons/x"), {
      params: Promise.resolve({ size: "1024" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("Favicon y apple-touch-icon", () => {
  it("el favicon (/icon) responde un PNG de 32x32", async () => {
    const response = await IconRoute();
    expect(response.status).toBe(200);
    const { width, height } = await readPngDimensions(response);
    expect(width).toBe(32);
    expect(height).toBe(32);
  });

  it("el apple-touch-icon responde un PNG de 180x180", async () => {
    const response = await AppleIconRoute();
    expect(response.status).toBe(200);
    const { width, height } = await readPngDimensions(response);
    expect(width).toBe(180);
    expect(height).toBe(180);
  });
});

describe("manifest.webmanifest", () => {
  it("declara los tres íconos PWA con los purposes correctos, incluido el maskable", () => {
    const result = manifest();
    expect(result.icons).toEqual([
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});

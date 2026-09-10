// Logo maestro leído del lado servidor para generar favicon e íconos PWA
// (§"Centraliza las rutas/uso del logo"). Mismo archivo público que
// src/components/brand/Logo.tsx usa directo en <img> — un único origen de
// verdad (public/brand/logo.png), nunca una copia redimensionada a mano
// por tamaño.
//
// Sin el archivo (antes de subir el logo definitivo), devuelve null y
// cada ruta que lo usa cae a su placeholder existente — cero regresión
// mientras tanto, activación automática en cuanto el archivo aparezca en
// el próximo build (las rutas de íconos son "force-static": se generan
// una vez en build, ver icons/[size]/route.tsx).
import { readFile } from "node:fs/promises";
import path from "node:path";

const LOGO_FILE_PATH = path.join(process.cwd(), "public", "brand", "logo.png");

let cached: string | null | undefined;

export async function loadBrandLogoDataUri(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const buffer = await readFile(LOGO_FILE_PATH);
    cached = `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    cached = null;
  }
  return cached;
}

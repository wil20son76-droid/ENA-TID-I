// Fase 7, §"Protección de API y rutas": primera línea de defensa barata
// para /api/sync/* y /api/users — rechaza de inmediato cualquier
// solicitud sin encabezado Authorization, antes de que llegue al route
// handler (que de todas formas vuelve a validar el token contra la base
// de datos — esto es una capa adicional, nunca un sustituto de esa
// validación real, ver src/lib/auth/serverAuth.ts).
//
// Las páginas de la app (/, /especies, /economia...) NO se protegen
// aquí a propósito: esta es una PWA fuertemente renderizada en cliente
// — el HTML que Next.js sirve para cualquier ruta es el mismo "shell"
// sin datos sensibles (todo el contenido real se lee de IndexedDB en el
// navegador). La protección real de esas rutas es
// src/components/auth/AuthGate.tsx, que decide en el cliente — sin red,
// incluso offline — si se muestra el login o la app. Ver SECURITY.md
// para la justificación completa de este diseño y sus límites.
//
// Las cabeceras de seguridad HTTP (incluida Content-Security-Policy)
// viven en next.config.ts, no aquí: se intentó primero una CSP con
// nonce por solicitud generada en este middleware (el patrón
// "recomendado" para bloquear scripts inline), pero el App Router de
// Next.js 16 con Turbopack inyecta el payload de RSC en `<script>`
// inline SIN aplicarles automáticamente ese nonce en este build —
// verificado en la práctica: con esa CSP la app se queda congelada en
// su HTML inicial, nunca hidrata (ver SECURITY.md §CSP para el detalle
// completo y por qué se optó por una política estática más simple en su
// lugar).
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/sync/", "/api/users"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsAuthHeader = PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (needsAuthHeader && !request.headers.get("authorization")) {
    return NextResponse.json({ error: "Falta el encabezado Authorization." }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/sync/:path*", "/api/users/:path*"],
};

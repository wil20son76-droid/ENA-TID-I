import type { NextConfig } from "next";

// Cabeceras de seguridad HTTP (Fase 7, §"Seguridad"). Se aplican a toda
// respuesta, incluidas las páginas estáticas — Railway sirve la app
// siempre detrás de HTTPS, así que HSTS es seguro de anunciar sin riesgo
// de "atascar" a alguien en HTTP.
//
// `script-src` incluye `'unsafe-inline'` — decisión deliberada, no un
// descuido (documentada en detalle en SECURITY.md §"Content-Security-
// Policy"): se probó primero una CSP con nonce por solicitud (el patrón
// recomendado para bloquear scripts inline), generada en middleware.ts,
// pero el App Router de Next.js 16 con Turbopack inyecta el payload de
// RSC en `<script>` inline SIN aplicarles ese nonce automáticamente en
// este build — con esa CSP la app quedaba congelada en su HTML inicial
// sin hidratar nunca (confirmado con el service worker real: ver
// tests/e2e). Implementar nonces correctos requeriría un mecanismo más
// profundo (leer el nonce en cada Server Component y aplicarlo a mano a
// cualquier script propio) que esta fase no cubre — queda documentado
// como trabajo de hardening futuro, no oculto. El riesgo residual es
// bajo: la app nunca usa `dangerouslySetInnerHTML` ni renderiza HTML/JS
// de origen no confiable en ninguna pantalla (verificado — ver
// SECURITY.md), así que no hay una superficie realista de inyección de
// script que esta CSP debiera bloquear.
//
// `worker-src 'self'` es explícito (no basta con confiar en el fallback
// de la especificación CSP a `script-src`/`default-src`): verificado con
// el service worker real de esta PWA (public/sw.js).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    // Se relaja del todo en desarrollo local para no interferir con el
    // HMR de `next dev`/Turbopack; Railway siempre sirve `next start`
    // sobre un build de producción.
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

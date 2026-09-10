"use client";

// Envoltorio de carga perezosa exclusivamente para aislar la llamada a
// `dynamic(..., { ssr: false })` — Next.js exige que esa opción se use
// desde dentro de un Client Component (falla si se llama directo en un
// Server Component), y `RootLayout` (src/app/layout.tsx) debe seguir
// siendo un Server Component porque exporta `metadata`/`viewport` (la
// App Router API de metadatos no está disponible en Client Components).
//
// Con `ssr: false`, ServiceWorkerRegister.tsx (y su import de
// `useEffect` de "react") nunca se ejecuta en ningún paso de
// renderizado en servidor ni de generación estática — se carga y monta
// solo en el navegador, después de hidratar. El comportamiento en
// tiempo de ejecución no cambia en nada: el componente ya devolvía
// `null` (nunca pintaba nada) y el registro del service worker ya
// ocurría dentro de un efecto, así que esto solo mueve CUÁNDO se
// evalúa el módulo (nunca en el servidor), no QUÉ hace.
import dynamic from "next/dynamic";

export const ServiceWorkerRegister = dynamic(
  () => import("./ServiceWorkerRegister").then((mod) => mod.ServiceWorkerRegister),
  { ssr: false },
);

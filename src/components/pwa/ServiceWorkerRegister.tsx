"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de la aplicación (public/sw.js) al montar la
 * app. No renderiza nada; solo dispara el registro una vez.
 *
 * Se importa siempre a través de ServiceWorkerRegisterLoader.tsx (nunca
 * directo desde layout.tsx) — ese envoltorio usa `dynamic(..., { ssr:
 * false })` para garantizar que este módulo jamás se evalúe durante el
 * renderizado en servidor/generación estática, solo en el navegador.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("No se pudo registrar el service worker:", error);
    });
  }, []);

  return null;
}

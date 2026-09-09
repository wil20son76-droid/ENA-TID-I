"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de la aplicación (public/sw.js) al montar la
 * app. No renderiza nada; solo dispara el registro una vez.
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

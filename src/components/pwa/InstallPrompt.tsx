"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Aviso discreto de instalación (§60/§76): solo aparece cuando el
 * navegador realmente ofrece la posibilidad ("beforeinstallprompt"), nunca
 * se fuerza, y desaparece si la persona lo descarta o ya está instalada.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  if (!deferredPrompt || dismissed) {
    return null;
  }

  return (
    // bottom-40 (no bottom-20, mismo nivel que QuickRegisterButton):
    // ambos pueden estar visibles a la vez (app sin instalar + sesión
    // activa) — este aviso se coloca por encima del FAB para que nunca
    // se superpongan, en vez de competir por el mismo espacio.
    <div className="fixed inset-x-4 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm shadow-lg dark:border-emerald-900 dark:bg-emerald-950">
      <span className="text-emerald-900 dark:text-emerald-100">
        Instala la app para abrirla como una aplicación del teléfono.
      </span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-xs text-emerald-700 dark:text-emerald-300"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={async () => {
            await deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            setDeferredPrompt(null);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-700 px-4 text-xs font-medium text-white"
        >
          Instalar
        </button>
      </div>
    </div>
  );
}

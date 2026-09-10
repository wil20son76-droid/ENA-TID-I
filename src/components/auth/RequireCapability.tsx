"use client";

// Guarda de UI por capacidad (Fase 7, §"Roles básicos"). Es solo UX —
// evita que un rol sin permiso vea un formulario que el servidor
// rechazaría igual (ver /api/sync/push + src/lib/auth/permissions.ts,
// que es la barrera real). Nunca se usa como única defensa.
import { hasCapability, ROLE_LABEL, type Capability } from "@/lib/auth/permissions";
import { useSessionContext } from "@/lib/auth/SessionContext";

export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: React.ReactNode;
}) {
  const { session } = useSessionContext();

  if (hasCapability(session.role, capability)) {
    return <>{children}</>;
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      No tienes permiso para esta acción con tu rol actual ({ROLE_LABEL[session.role]}).
    </div>
  );
}

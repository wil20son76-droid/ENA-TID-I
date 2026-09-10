// Sesión local persistente (Fase 7, "regla crítica de autenticación": la
// app nunca debe exigir red en cada apertura). Se guarda en localStorage
// —mismo criterio que src/lib/db/deviceId.ts—, no en Dexie: hace falta
// leerla de forma síncrona nada más abrir la app, antes incluso de que
// IndexedDB esté lista, y es un dato simple que no necesita transacciones
// ni consultas.
//
// Esta sesión NUNCA se borra sola por "vieja" ni por estar el dispositivo
// offline: solo un logout explícito, o que el propio servidor la rechace
// al intentar sincronizar (sesión expirada/revocada — ver
// src/lib/sync/client.ts), la invalida. Mientras exista en localStorage,
// AuthGate deja pasar a la app sin pedir red — ver SECURITY.md para las
// implicaciones de seguridad de esta decisión.
import type { UserRole } from "./permissions";

export interface ClientSession {
  token: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  /**
   * true justo tras un login con una contraseña temporal asignada por
   * ADMIN (§"Reset por ADMIN") — AuthGate bloquea el resto de la app con
   * ForceChangePasswordScreen hasta que se cambie. `undefined`/`false` en
   * cualquier sesión normal.
   */
  mustChangePassword?: boolean;
}

const SESSION_STORAGE_KEY = "piscicultura:session";

export function getSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClientSession>;
    if (!parsed.token || !parsed.userId || !parsed.username || !parsed.role) return null;
    return parsed as ClientSession;
  } catch {
    return null;
  }
}

export function setSession(session: ClientSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

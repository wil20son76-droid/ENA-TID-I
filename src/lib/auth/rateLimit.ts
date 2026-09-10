// Límite de intentos de login en memoria (Fase 7, §"Seguridad": proteger
// /api/auth/login de fuerza bruta). Deliberadamente sin Redis ni ningún
// servicio externo — Railway despliega esta app como una única instancia
// web, así que un mapa en memoria del proceso alcanza. Limitación
// documentada en SECURITY.md: se reinicia con cada despliegue/reinicio
// del proceso (un atacante puede "resetear" su propio contador forzando
// eso, pero no controla los despliegues), y no se comparte entre
// instancias si algún día hay más de una detrás de un balanceador.
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function isRateLimited(key: string): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return false;
  return bucket.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function resetAttempts(key: string): void {
  buckets.delete(key);
}

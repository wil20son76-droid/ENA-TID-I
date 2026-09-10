// Matriz de permisos (Fase 7, §"Roles básicos" / §"Validación de permisos
// también en servidor"). Función pura, isomórfica (sin Node ni DOM): se
// importa igual desde el servidor (para rechazar operaciones de push que
// el rol no autoriza — la validación real) y desde el cliente (para
// ocultar/deshabilitar acciones que el rol no puede realizar — solo UX,
// nunca la barrera de seguridad real).
//
// El modelo es de CAPACIDADES, no una jerarquía lineal de roles: "solo
// lectura" no es "menos" que "trabajador", es un eje ortogonal (cero
// escritura). Cada rol es un conjunto de capacidades; cada tipo de
// operación de sincronización requiere exactamente una capacidad.
export type UserRole = "ADMIN" | "MANAGER" | "WORKER" | "READ_ONLY";

export type Capability =
  | "READ"
  | "FIELD_OPS"
  | "MANAGE_CATALOG"
  | "MANAGE_ECONOMY"
  | "MANAGE_USERS";

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  ADMIN: new Set(["READ", "FIELD_OPS", "MANAGE_CATALOG", "MANAGE_ECONOMY", "MANAGE_USERS"]),
  MANAGER: new Set(["READ", "FIELD_OPS", "MANAGE_CATALOG", "MANAGE_ECONOMY"]),
  WORKER: new Set(["READ", "FIELD_OPS"]),
  READ_ONLY: new Set(["READ"]),
};

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

/**
 * `entityType` tal como viaja en `SyncQueueRecord`/`PushOperation`
 * (src/lib/validation/sync.ts) — incluye tanto entidades simples
 * (Species, Task...) como comandos de negocio compuestos (RegisterSale,
 * RegisterFeeding...). "FIELD_OPS" es lo que un Trabajador de campo
 * registra a diario; "MANAGE_CATALOG" son decisiones de gestión
 * (catálogos, lotes, traslados, configuración de la finca); "MANAGE_ECONOMY"
 * es todo lo que mueve dinero.
 */
const ENTITY_CAPABILITY: Record<string, Capability> = {
  // Operación diaria de campo (Fases 3-4).
  FeedingRecord: "FIELD_OPS",
  RegisterFeeding: "FIELD_OPS",
  MortalityRecord: "FIELD_OPS",
  Sampling: "FIELD_OPS",
  WaterQualityRecord: "FIELD_OPS",
  Task: "FIELD_OPS",

  // Catálogos y decisiones de gestión (Fases 1-3).
  Species: "MANAGE_CATALOG",
  Pond: "MANAGE_CATALOG",
  FishBatch: "MANAGE_CATALOG",
  Stocking: "MANAGE_CATALOG",
  FishTransfer: "MANAGE_CATALOG",
  Feed: "MANAGE_CATALOG",
  FeedInventoryMovement: "MANAGE_CATALOG",
  CreateFeedWithInitialStock: "MANAGE_CATALOG",
  Supplier: "MANAGE_CATALOG",
  Customer: "MANAGE_CATALOG",
  FarmSettings: "MANAGE_CATALOG",

  // Economía (Fase 5): todo lo que mueve dinero o cierra producción.
  Purchase: "MANAGE_ECONOMY",
  RegisterPurchase: "MANAGE_ECONOMY",
  Sale: "MANAGE_ECONOMY",
  RegisterSale: "MANAGE_ECONOMY",
  Expense: "MANAGE_ECONOMY",
  Harvest: "MANAGE_ECONOMY",
};

/** `null` para un entityType desconocido — nunca se autoriza por defecto (fail-closed). */
export function capabilityForEntityType(entityType: string): Capability | null {
  return ENTITY_CAPABILITY[entityType] ?? null;
}

/**
 * Decide si `role` puede enviar una operación de push para `entityType`.
 * Es la función que realmente se usa como barrera de seguridad (llamada
 * desde /api/sync/push) — la UI la reutiliza solo para no mostrar
 * controles que el servidor rechazaría de todas formas.
 */
export function canWriteEntity(role: UserRole, entityType: string): boolean {
  const capability = capabilityForEntityType(entityType);
  if (!capability) return false;
  return hasCapability(role, capability);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Encargado",
  WORKER: "Trabajador",
  READ_ONLY: "Solo lectura",
};

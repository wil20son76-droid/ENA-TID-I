// Clasificación de tareas por fecha (§18-§27 del encargo de Fase 4).
// Función pura, sin acceso a Dexie ni a Prisma — mismo principio que el
// resto del dominio (batchLedger.ts, feedLedger.ts, waterQuality.ts).
//
// Task es una entidad MUTABLE (§19: "Task es una entidad mutable" — no
// append-only como el resto del dominio productivo), porque una tarea se
// edita y se completa desde cualquier dispositivo: usa el mismo
// versionado/conflicto last-write-wins que Species/Pond/Feed
// (repositories/base.ts createRecord/updateRecord).

export type TaskStatus = "PENDING" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TaskBucket = "overdue" | "today" | "upcoming" | "completed" | "cancelled";

export interface TaskLike {
  /** Fecha ISO (con o sin hora) — solo se compara la parte de fecha. */
  dueDate: string;
  status: TaskStatus;
}

/**
 * Clasifica una tarea para las secciones de `/tareas` (§20: Hoy /
 * Próximas / Vencidas / Completadas). `COMPLETED`/`CANCELLED` siempre
 * ganan sobre la fecha — una tarea completada nunca aparece como vencida
 * aunque su fecha ya haya pasado. `todayIsoDate` se recibe como parámetro
 * (en vez de leer `Date.now()` internamente) para que la función sea
 * pura y 100% determinista en los tests.
 */
export function classifyTask(task: TaskLike, todayIsoDate: string): TaskBucket {
  if (task.status === "COMPLETED") return "completed";
  if (task.status === "CANCELLED") return "cancelled";

  const dueDateOnly = task.dueDate.slice(0, 10);
  if (dueDateOnly < todayIsoDate) return "overdue";
  if (dueDateOnly === todayIsoDate) return "today";
  return "upcoming";
}

/** Prioridad de ordenamiento visual dentro de una misma sección: más urgente primero. */
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export function comparePriority(a: TaskPriority, b: TaskPriority): number {
  return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
}

// --- Recordatorio de muestreo (§26) — solo una sugerencia visual, nunca crea una Task ---

/** Umbral inicial (§26): configurable en el futuro. */
export const SAMPLING_REMINDER_THRESHOLD_DAYS = 15;

/**
 * `true` si el lote lleva más de `SAMPLING_REMINDER_THRESHOLD_DAYS` días
 * sin muestreo (o nunca tuvo uno). Puramente informativo: nunca crea una
 * Task automáticamente (§26 es explícito en esto).
 */
export function needsSamplingReminder(
  lastSamplingDate: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastSamplingDate) return true;
  const ageDays = (now.getTime() - new Date(lastSamplingDate).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > SAMPLING_REMINDER_THRESHOLD_DAYS;
}

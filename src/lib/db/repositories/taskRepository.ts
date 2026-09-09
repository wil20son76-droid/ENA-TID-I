import { db } from "../schema";
import type { TaskFields, TaskRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Task" as const;

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  dueDate: string;
  dueTime?: string | null;
  priority?: TaskFields["priority"];
  pondId?: string | null;
  batchId?: string | null;
  assignedToName?: string | null;
  notes?: string | null;
}

/**
 * Crea una tarea (§18-§21 del encargo de Fase 4). A diferencia del resto
 * del dominio productivo (append-only), Task es mutable: usa
 * createRecord/updateRecord (versionado LWW), igual criterio que
 * Species/Pond/Feed — funciona offline por el mismo mecanismo, sin
 * necesidad de ningún tratamiento especial (§19).
 */
export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  if (!input.title.trim()) {
    throw new Error("El título de la tarea es obligatorio.");
  }

  return createRecord<TaskRecord>(db.tasks, ENTITY_TYPE, {
    title: input.title.trim(),
    description: input.description ?? null,
    dueDate: input.dueDate,
    dueTime: input.dueTime ?? null,
    priority: input.priority ?? "NORMAL",
    status: "PENDING",
    pondId: input.pondId ?? null,
    batchId: input.batchId ?? null,
    assignedToName: input.assignedToName ?? null,
    notes: input.notes ?? null,
    completedAt: null,
  });
}

export async function updateTask(id: string, patch: Partial<TaskFields>): Promise<TaskRecord> {
  return updateRecord<TaskRecord>(db.tasks, ENTITY_TYPE, id, patch);
}

/**
 * Completa una tarea (§22): status=COMPLETED + completedAt=ahora, en una
 * sola actualización versionada. Funciona offline igual que cualquier
 * otro `updateTask`.
 */
export async function completeTask(id: string): Promise<TaskRecord> {
  return updateRecord<TaskRecord>(db.tasks, ENTITY_TYPE, id, {
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
  });
}

export async function cancelTask(id: string): Promise<TaskRecord> {
  return updateRecord<TaskRecord>(db.tasks, ENTITY_TYPE, id, { status: "CANCELLED" });
}

/** Reabre una tarea completada/cancelada por error. */
export async function reopenTask(id: string): Promise<TaskRecord> {
  return updateRecord<TaskRecord>(db.tasks, ENTITY_TYPE, id, {
    status: "PENDING",
    completedAt: null,
  });
}

export async function deleteTask(id: string): Promise<void> {
  return softDeleteRecord<TaskRecord>(db.tasks, ENTITY_TYPE, id);
}

export async function listTasks(): Promise<TaskRecord[]> {
  const all = await db.tasks.toArray();
  return all.filter((t) => !t.deletedAt);
}

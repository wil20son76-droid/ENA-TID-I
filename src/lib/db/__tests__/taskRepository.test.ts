import { beforeEach, describe, expect, it } from "vitest";

import {
  cancelTask,
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  updateTask,
} from "../repositories/taskRepository";
import { db } from "../schema";

describe("taskRepository", () => {
  beforeEach(async () => {
    await db.tasks.clear();
    await db.syncQueue.clear();
  });

  it("crea una tarea PENDING con los valores por defecto correctos", async () => {
    const task = await createTask({ title: "Revisar E01", dueDate: "2026-09-15T00:00:00.000Z" });

    expect(task.status).toBe("PENDING");
    expect(task.priority).toBe("NORMAL");
    expect(task.completedAt).toBeNull();
    expect(task.version).toBe(1);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].entityType).toBe("Task");
    expect(queue[0].operation).toBe("CREATE");
  });

  it("rechaza un título vacío", async () => {
    await expect(createTask({ title: "   ", dueDate: "2026-09-15T00:00:00.000Z" })).rejects.toThrow(
      /título/i,
    );
  });

  it("una tarea puede crearse sin estanque ni lote (§23)", async () => {
    const task = await createTask({
      title: "Comprar alimento crecimiento",
      dueDate: "2026-09-15T00:00:00.000Z",
    });
    expect(task.pondId).toBeNull();
    expect(task.batchId).toBeNull();
  });

  it("completar una tarea (§22): status=COMPLETED + completedAt, incrementa versión", async () => {
    const task = await createTask({ title: "Muestrear E01", dueDate: "2026-09-15T00:00:00.000Z" });
    const completed = await completeTask(task.id);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.version).toBe(2);

    const queue = await db.syncQueue.orderBy("createdAt").toArray();
    expect(queue).toHaveLength(2); // CREATE + UPDATE
    expect(queue[1]).toMatchObject({ operation: "UPDATE", entityId: task.id });
  });

  it("cancelar y reabrir una tarea", async () => {
    const task = await createTask({ title: "X", dueDate: "2026-09-15T00:00:00.000Z" });
    const cancelled = await cancelTask(task.id);
    expect(cancelled.status).toBe("CANCELLED");

    const reopened = await reopenTask(task.id);
    expect(reopened.status).toBe("PENDING");
    expect(reopened.completedAt).toBeNull();
  });

  it("actualizar campos arbitrarios de una tarea", async () => {
    const task = await createTask({ title: "X", dueDate: "2026-09-15T00:00:00.000Z" });
    const updated = await updateTask(task.id, { title: "Y", priority: "URGENT" });
    expect(updated.title).toBe("Y");
    expect(updated.priority).toBe("URGENT");
  });

  it("eliminar (soft-delete) una tarea la saca de listTasks", async () => {
    const task = await createTask({ title: "X", dueDate: "2026-09-15T00:00:00.000Z" });
    await deleteTask(task.id);
    const tasks = await listTasks();
    expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
  });
});

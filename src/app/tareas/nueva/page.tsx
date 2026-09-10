"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import { RequireCapability } from "@/components/auth/RequireCapability";
import type { TaskPriority } from "@/lib/db/types";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";
import { db } from "@/lib/db/schema";
import { createTask } from "@/lib/db/repositories/taskRepository";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewTaskForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPondId = searchParams.get("pondId") ?? "";
  const preselectedBatchId = searchParams.get("batchId") ?? "";

  const ponds = useLiveQuery(async () => {
    const all = await db.ponds.toArray();
    return all.filter((p) => !p.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];
  const allBatches = useLiveQuery(async () => {
    const all = await db.fishBatches.toArray();
    return all.filter((b) => !b.deletedAt).sort((a, b) => a.code.localeCompare(b.code, "es"));
  }, []) ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [pondId, setPondId] = useState(preselectedPondId);
  const [batchId, setBatchId] = useState(preselectedBatchId);
  const [assignedToName, setAssignedToName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createTask({
        title,
        description: description.trim() || null,
        dueDate: new Date(dueDate).toISOString(),
        dueTime: dueTime || null,
        priority,
        pondId: pondId || null,
        batchId: batchId || null,
        assignedToName: assignedToName.trim() || null,
      });
      router.push("/tareas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Nueva tarea</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Título</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={submitting}
            placeholder="Ej. Revisar E01"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Fecha</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Hora (opcional)</span>
            <input
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Prioridad</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((key) => (
              <option key={key} value={key}>
                {TASK_PRIORITY_LABEL[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Estanque (opcional)</span>
          <select
            value={pondId}
            onChange={(event) => setPondId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Sin estanque</option>
            {ponds.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Lote (opcional)</span>
          <select
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Sin lote</option>
            {allBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Responsable (opcional)</span>
          <input
            type="text"
            value={assignedToName}
            onChange={(event) => setAssignedToName(event.target.value)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Descripción (opcional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            rows={3}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Guardar tarea
        </button>
      </form>
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <RequireCapability capability="FIELD_OPS">
      <Suspense fallback={<p className="text-sm text-zinc-500">Cargando…</p>}>
        <NewTaskForm />
      </Suspense>
    </RequireCapability>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { classifyTask, comparePriority, type TaskBucket } from "@/lib/domain/task";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";
import { db } from "@/lib/db/schema";
import { completeTask, reopenTask } from "@/lib/db/repositories/taskRepository";
import type { TaskRecord } from "@/lib/db/types";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "short" }).format(new Date(iso));
}

const SECTIONS: Array<{ bucket: TaskBucket; label: string }> = [
  { bucket: "overdue", label: "Vencidas" },
  { bucket: "today", label: "Hoy" },
  { bucket: "upcoming", label: "Próximas" },
  { bucket: "completed", label: "Completadas" },
];

function TaskRow({
  task,
  pondCode,
  batchCode,
  onToggle,
}: {
  task: TaskRecord;
  pondCode: string | undefined;
  batchCode: string | undefined;
  onToggle: () => void;
}) {
  const done = task.status === "COMPLETED";
  return (
    <li className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Reabrir tarea" : "Completar tarea"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
          done
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-zinc-300 text-transparent dark:border-zinc-600"
        }`}
      >
        ✓
      </button>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className={`text-sm ${done ? "text-zinc-400 line-through" : ""}`}>{task.title}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatDate(task.dueDate)}
          {task.dueTime ? ` · ${task.dueTime}` : ""}
          {pondCode ? ` · ${pondCode}` : ""}
          {batchCode ? ` · ${batchCode}` : ""}
          {task.priority !== "NORMAL" ? ` · ${TASK_PRIORITY_LABEL[task.priority]}` : ""}
        </span>
      </div>
    </li>
  );
}

export default function TasksPage() {
  const [openSections, setOpenSections] = useState<Set<TaskBucket>>(
    new Set(["overdue", "today", "upcoming"]),
  );

  const data = useLiveQuery(async () => {
    const [tasks, ponds, batches] = await Promise.all([
      db.tasks.toArray(),
      db.ponds.toArray(),
      db.fishBatches.toArray(),
    ]);
    return {
      tasks: tasks.filter((t) => !t.deletedAt),
      pondById: new Map(ponds.map((p) => [p.id, p])),
      batchById: new Map(batches.map((b) => [b.id, b])),
    };
  }, []);

  const tasks = data?.tasks ?? [];
  const pondById = data?.pondById ?? new Map();
  const batchById = data?.batchById ?? new Map();
  const today = todayIsoDate();

  const byBucket = new Map<TaskBucket, TaskRecord[]>();
  for (const task of tasks) {
    const bucket = classifyTask(task, today);
    if (bucket === "cancelled") continue; // no tiene sección propia en esta fase
    const list = byBucket.get(bucket) ?? [];
    list.push(task);
    byBucket.set(bucket, list);
  }
  for (const list of byBucket.values()) {
    list.sort((a, b) => comparePriority(a.priority, b.priority) || a.dueDate.localeCompare(b.dueDate));
  }

  function toggleSection(bucket: TaskBucket) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  async function handleToggle(task: TaskRecord) {
    if (task.status === "COMPLETED") {
      await reopenTask(task.id);
    } else {
      await completeTask(task.id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Tareas</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Funciona sin conexión — crear, editar y completar tareas se sincroniza solo.
          </p>
        </div>
        <Link
          href="/calendario"
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Calendario
        </Link>
      </div>

      <Link
        href="/tareas/nueva"
        className="rounded-lg bg-emerald-700 px-5 py-4 text-center text-base font-medium text-white transition-colors hover:bg-emerald-800"
      >
        + Nueva tarea
      </Link>

      {SECTIONS.map(({ bucket, label }) => {
        const items = byBucket.get(bucket) ?? [];
        const open = openSections.has(bucket);
        return (
          <section key={bucket} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => toggleSection(bucket)}
              className="flex items-center justify-between text-sm font-semibold text-zinc-700 dark:text-zinc-300"
            >
              <span>
                {label} <span className="text-zinc-400">({items.length})</span>
              </span>
              <span className="text-xs text-zinc-400">{open ? "Ocultar" : "Mostrar"}</span>
            </button>
            {open && (
              <>
                {items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
                    Nada aquí.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        pondCode={task.pondId ? pondById.get(task.pondId)?.code : undefined}
                        batchCode={task.batchId ? batchById.get(task.batchId)?.code : undefined}
                        onToggle={() => handleToggle(task)}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

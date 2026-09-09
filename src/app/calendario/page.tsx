"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/schema";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateLong(isoDateStr: string): string {
  return new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${isoDateStr}T00:00:00.000Z`),
  );
}

type CalendarEventKind = "task-pending" | "task-completed" | "harvest-estimate" | "sampling" | "water-quality";

interface CalendarEvent {
  date: string;
  kind: CalendarEventKind;
  label: string;
  href?: string;
}

const KIND_META: Record<CalendarEventKind, { icon: string; historic: boolean }> = {
  "task-pending": { icon: "☐", historic: false },
  "task-completed": { icon: "✓", historic: true },
  "harvest-estimate": { icon: "🌾", historic: false },
  sampling: { icon: "📏", historic: true },
  "water-quality": { icon: "💧", historic: true },
};

export default function CalendarPage() {
  const [view, setView] = useState<"agenda" | "mes">("agenda");
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());

  const data = useLiveQuery(async () => {
    const [tasks, batches, samplings, waterQuality, ponds] = await Promise.all([
      db.tasks.toArray(),
      db.fishBatches.toArray(),
      db.samplings.toArray(),
      db.waterQualityRecords.toArray(),
      db.ponds.toArray(),
    ]);

    const pondById = new Map(ponds.map((p) => [p.id, p]));

    const events: CalendarEvent[] = [];
    for (const task of tasks) {
      if (task.deletedAt || task.status === "CANCELLED") continue;
      events.push({
        date: task.dueDate.slice(0, 10),
        kind: task.status === "COMPLETED" ? "task-completed" : "task-pending",
        label: task.title,
        href: "/tareas",
      });
    }
    for (const batch of batches) {
      if (batch.deletedAt || !batch.expectedHarvestDate) continue;
      events.push({
        date: batch.expectedHarvestDate.slice(0, 10),
        kind: "harvest-estimate",
        label: `Cosecha estimada — ${batch.code}`,
        href: `/lotes/${batch.id}`,
      });
    }
    for (const sampling of samplings) {
      if (sampling.deletedAt) continue;
      const pond = pondById.get(sampling.pondId);
      events.push({
        date: sampling.date.slice(0, 10),
        kind: "sampling",
        label: `Muestreo realizado${pond ? ` — ${pond.code}` : ""}`,
      });
    }
    for (const record of waterQuality) {
      if (record.deletedAt) continue;
      const pond = pondById.get(record.pondId);
      events.push({
        date: record.date.slice(0, 10),
        kind: "water-quality",
        label: `Medición de agua${pond ? ` — ${pond.code}` : ""}`,
        href: "/calidad-agua",
      });
    }

    const byDate = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const list = byDate.get(event.date) ?? [];
      list.push(event);
      byDate.set(event.date, list);
    }
    return byDate;
  }, []);

  const byDate = useMemo(() => data ?? new Map<string, CalendarEvent[]>(), [data]);

  const today = todayIsoDate();

  // Agenda: hoy + los próximos 14 días con algún evento (además de hoy, siempre visible).
  const agendaDates = useMemo(() => {
    const dates = new Set<string>([today]);
    const base = new Date(`${today}T00:00:00.000Z`);
    for (let i = 0; i <= 14; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      const iso = isoDate(d);
      if (byDate.has(iso)) dates.add(iso);
    }
    return [...dates].sort();
  }, [byDate, today]);

  // Vista mensual simple: grid del mes de `selectedDate`.
  const monthDays = useMemo(() => {
    const [year, month] = selectedDate.split("-").map(Number);
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const startWeekday = firstOfMonth.getUTCDay(); // 0=domingo
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ iso: isoDate(new Date(Date.UTC(year, month - 1, day))), day });
    }
    return cells;
  }, [selectedDate]);

  const selectedDayEvents = byDate.get(selectedDate) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Calendario</h2>
        <Link
          href="/tareas"
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Tareas
        </Link>
      </div>

      <div className="flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setView("agenda")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            view === "agenda"
              ? "bg-emerald-700 text-white"
              : "text-zinc-600 dark:text-zinc-300"
          }`}
        >
          Agenda
        </button>
        <button
          type="button"
          onClick={() => setView("mes")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            view === "mes" ? "bg-emerald-700 text-white" : "text-zinc-600 dark:text-zinc-300"
          }`}
        >
          Mes
        </button>
      </div>

      {view === "agenda" ? (
        <div className="flex flex-col gap-3">
          {agendaDates.map((date) => {
            const events = byDate.get(date) ?? [];
            const isToday = date === today;
            return (
              <section key={date} className="flex flex-col gap-1">
                <h3 className={`text-sm font-semibold ${isToday ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                  {formatDateLong(date)} {isToday ? "· Hoy" : ""}
                </h3>
                {events.length === 0 ? (
                  <p className="text-xs text-zinc-400">Sin eventos.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {events.map((event, index) => (
                      <EventRow key={index} event={event} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            type="month"
            value={selectedDate.slice(0, 7)}
            onChange={(event) => setSelectedDate(`${event.target.value}-01`)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-400">
            {["D", "L", "M", "X", "J", "V", "S"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthDays.map((cell, index) => {
              if (!cell) return <span key={index} />;
              const hasEvents = byDate.has(cell.iso);
              const isSelected = cell.iso === selectedDate;
              const isToday = cell.iso === today;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedDate(cell.iso)}
                  className={`flex flex-col items-center gap-0.5 rounded-lg py-2 text-sm ${
                    isSelected
                      ? "bg-emerald-700 text-white"
                      : isToday
                        ? "border border-emerald-600 text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {cell.day}
                  <span
                    className={`h-1 w-1 rounded-full ${hasEvents ? (isSelected ? "bg-white" : "bg-emerald-600") : "bg-transparent"}`}
                  />
                </button>
              );
            })}
          </div>

          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {formatDateLong(selectedDate)}
            </h3>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs text-zinc-400">Sin eventos.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {selectedDayEvents.map((event, index) => (
                  <EventRow key={index} event={event} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const meta = KIND_META[event.kind];
  const content = (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span aria-hidden="true">{meta.icon}</span>
      <span className={meta.historic ? "text-zinc-500 dark:text-zinc-400" : ""}>{event.label}</span>
      <span className="ml-auto text-xs text-zinc-400">
        {meta.historic ? "Evento histórico" : "Tarea pendiente"}
      </span>
    </div>
  );
  return <li>{event.href ? <Link href={event.href}>{content}</Link> : content}</li>;
}

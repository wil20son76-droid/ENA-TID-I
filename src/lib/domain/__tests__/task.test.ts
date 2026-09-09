import { describe, expect, it } from "vitest";

import { classifyTask, comparePriority, needsSamplingReminder } from "../task";

const TODAY = "2026-09-15";

describe("classifyTask (§18-§27, §39)", () => {
  it("tarea de hoy", () => {
    expect(classifyTask({ dueDate: "2026-09-15T00:00:00.000Z", status: "PENDING" }, TODAY)).toBe(
      "today",
    );
  });

  it("tarea de mañana -> próxima", () => {
    expect(classifyTask({ dueDate: "2026-09-16T00:00:00.000Z", status: "PENDING" }, TODAY)).toBe(
      "upcoming",
    );
  });

  it("tarea vencida (ayer, pendiente)", () => {
    expect(classifyTask({ dueDate: "2026-09-14T00:00:00.000Z", status: "PENDING" }, TODAY)).toBe(
      "overdue",
    );
  });

  it("tarea completada, aunque su fecha ya pasó, nunca es 'vencida'", () => {
    expect(classifyTask({ dueDate: "2026-09-01T00:00:00.000Z", status: "COMPLETED" }, TODAY)).toBe(
      "completed",
    );
  });

  it("tarea cancelada se clasifica aparte, no como pendiente", () => {
    expect(classifyTask({ dueDate: "2026-09-16T00:00:00.000Z", status: "CANCELLED" }, TODAY)).toBe(
      "cancelled",
    );
  });
});

describe("comparePriority", () => {
  it("URGENT antes que HIGH antes que NORMAL antes que LOW", () => {
    const order: Array<"LOW" | "NORMAL" | "HIGH" | "URGENT"> = ["LOW", "URGENT", "NORMAL", "HIGH"];
    const sorted = [...order].sort(comparePriority);
    expect(sorted).toEqual(["URGENT", "HIGH", "NORMAL", "LOW"]);
  });
});

describe("needsSamplingReminder (§26)", () => {
  it("sin ningún muestreo: siempre sugiere", () => {
    expect(needsSamplingReminder(null)).toBe(true);
  });

  it("muestreo de hace 10 días: no sugiere todavía", () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    expect(needsSamplingReminder("2026-09-05T00:00:00.000Z", now)).toBe(false);
  });

  it("muestreo de hace 21 días (> 15): sugiere", () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    expect(needsSamplingReminder("2026-08-25T00:00:00.000Z", now)).toBe(true);
  });
});

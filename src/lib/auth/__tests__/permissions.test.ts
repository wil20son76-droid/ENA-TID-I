import { describe, expect, it } from "vitest";

import { canWriteEntity, capabilityForEntityType, hasCapability } from "../permissions";

describe("permissions", () => {
  it("ADMIN tiene las cinco capacidades, incluida MANAGE_USERS", () => {
    for (const capability of ["READ", "FIELD_OPS", "MANAGE_CATALOG", "MANAGE_ECONOMY", "MANAGE_USERS"] as const) {
      expect(hasCapability("ADMIN", capability)).toBe(true);
    }
  });

  it("MANAGER tiene todo menos MANAGE_USERS", () => {
    expect(hasCapability("MANAGER", "READ")).toBe(true);
    expect(hasCapability("MANAGER", "FIELD_OPS")).toBe(true);
    expect(hasCapability("MANAGER", "MANAGE_CATALOG")).toBe(true);
    expect(hasCapability("MANAGER", "MANAGE_ECONOMY")).toBe(true);
    expect(hasCapability("MANAGER", "MANAGE_USERS")).toBe(false);
  });

  it("WORKER solo tiene lectura y operación de campo", () => {
    expect(hasCapability("WORKER", "READ")).toBe(true);
    expect(hasCapability("WORKER", "FIELD_OPS")).toBe(true);
    expect(hasCapability("WORKER", "MANAGE_CATALOG")).toBe(false);
    expect(hasCapability("WORKER", "MANAGE_ECONOMY")).toBe(false);
    expect(hasCapability("WORKER", "MANAGE_USERS")).toBe(false);
  });

  it("READ_ONLY solo tiene lectura — cero capacidades de escritura", () => {
    expect(hasCapability("READ_ONLY", "READ")).toBe(true);
    expect(hasCapability("READ_ONLY", "FIELD_OPS")).toBe(false);
    expect(hasCapability("READ_ONLY", "MANAGE_CATALOG")).toBe(false);
    expect(hasCapability("READ_ONLY", "MANAGE_ECONOMY")).toBe(false);
  });

  it("canWriteEntity: un Trabajador puede registrar mortalidad/alimentación/muestreo/calidad de agua/tareas", () => {
    for (const entityType of [
      "MortalityRecord",
      "RegisterFeeding",
      "FeedingRecord",
      "Sampling",
      "WaterQualityRecord",
      "Task",
    ]) {
      expect(canWriteEntity("WORKER", entityType)).toBe(true);
    }
  });

  it("canWriteEntity: un Trabajador NUNCA puede tocar catálogos ni economía", () => {
    for (const entityType of ["Species", "Pond", "FishBatch", "Purchase", "RegisterSale", "Expense", "Harvest"]) {
      expect(canWriteEntity("WORKER", entityType)).toBe(false);
    }
  });

  it("canWriteEntity: Solo lectura nunca puede escribir nada, ni siquiera operación de campo", () => {
    for (const entityType of ["MortalityRecord", "Task", "Species", "RegisterSale"]) {
      expect(canWriteEntity("READ_ONLY", entityType)).toBe(false);
    }
  });

  it("canWriteEntity: un Encargado puede economía y catálogos pero no gestionar usuarios (eso no es un entityType de sync)", () => {
    expect(canWriteEntity("MANAGER", "RegisterSale")).toBe(true);
    expect(canWriteEntity("MANAGER", "Species")).toBe(true);
    expect(canWriteEntity("MANAGER", "Expense")).toBe(true);
  });

  it("un entityType desconocido nunca se autoriza (fail-closed), para ningún rol", () => {
    expect(capabilityForEntityType("AlgoQueNoExiste")).toBeNull();
    expect(canWriteEntity("ADMIN", "AlgoQueNoExiste")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { getConflictMessage } from "../conflictMessages";

describe("getConflictMessage", () => {
  it("RegisterFeeding: menciona la cantidad y el stock, como un único incidente (§23)", () => {
    const message = getConflictMessage("RegisterFeeding", { quantityKg: 18 });
    expect(message).toBe(
      "No se pudo sincronizar la alimentación de 18 kg porque el stock disponible cambió desde otro dispositivo.",
    );
    expect(message).not.toMatch(/Feeding|Inventory|FeedingRecord/);
  });

  it("FeedInventoryMovement: menciona la cantidad y el stock", () => {
    const message = getConflictMessage("FeedInventoryMovement", { quantityKg: 70 });
    expect(message).toContain("70 kg");
    expect(message).toContain("stock disponible cambió");
  });

  it("FishTransfer: menciona el balance del estanque, no una versión", () => {
    const message = getConflictMessage("FishTransfer", { quantity: 400 });
    expect(message).toContain("400 peces");
    expect(message).toContain("balance del estanque");
    expect(message).not.toMatch(/versión/i);
  });

  it("FishTransfer con 1 pez usa singular", () => {
    const message = getConflictMessage("FishTransfer", { quantity: 1 });
    expect(message).toContain("1 pez ");
  });

  it("MortalityRecord: menciona el balance del estanque", () => {
    const message = getConflictMessage("MortalityRecord", { quantity: 3 });
    expect(message).toContain("3 peces");
    expect(message).toContain("balance del estanque");
  });

  it("Species/Pond/FishBatch/Feed: mensaje genérico de versión (LWW real)", () => {
    for (const entityType of ["Species", "Pond", "FishBatch", "Feed"] as const) {
      expect(getConflictMessage(entityType, {})).toMatch(/versión más reciente/);
    }
  });

  it("payload sin el campo esperado: devuelve un mensaje sin cantidad, sin fallar", () => {
    expect(getConflictMessage("RegisterFeeding", {})).toBe(
      "No se pudo sincronizar la alimentación porque el stock disponible cambió desde otro dispositivo.",
    );
    expect(getConflictMessage("FishTransfer", null)).toContain("traslado");
  });
});

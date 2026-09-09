import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  createSpecies,
  deactivateSpecies,
  deleteSpecies,
  listActiveSpecies,
  updateSpecies,
} from "../repositories/speciesRepository";

describe("speciesRepository", () => {
  beforeEach(async () => {
    await db.species.clear();
    await db.syncQueue.clear();
    // El deviceId se cachea en memoria de módulo (una instalación = un
    // dispositivo durante toda la sesión de la app): no se limpia entre
    // tests para reflejar ese comportamiento real.
  });

  it("crea una especie y encola una única operación CREATE en el outbox", async () => {
    const species = await createSpecies({ commonName: "Pacú" });

    expect(species.id).toBeTruthy();
    expect(species.commonName).toBe("Pacú");
    expect(species.active).toBe(true);
    expect(species.version).toBe(1);

    const stored = await db.species.get(species.id);
    expect(stored).toEqual(species);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entityType: "Species",
      entityId: species.id,
      operation: "CREATE",
      status: "pending",
    });
  });

  it("solo lista especies activas y no eliminadas", async () => {
    const a = await createSpecies({ commonName: "Tilapia" });
    await createSpecies({ commonName: "Tambaquí" });
    await deactivateSpecies(a.id);

    const active = await listActiveSpecies();
    expect(active.map((s) => s.commonName)).toEqual(["Tambaquí"]);
  });

  it("actualizar incrementa la versión y encola una operación UPDATE", async () => {
    const species = await createSpecies({ commonName: "Pacú" });

    const updated = await updateSpecies(species.id, {
      targetWeightGrams: 900,
    });

    expect(updated.version).toBe(2);
    expect(updated.targetWeightGrams).toBe(900);

    const queue = await db.syncQueue.orderBy("createdAt").toArray();
    expect(queue).toHaveLength(2);
    expect(queue[1]).toMatchObject({ operation: "UPDATE", entityId: species.id });
  });

  it("el soft-delete marca deletedAt y no borra el registro físicamente", async () => {
    const species = await createSpecies({ commonName: "Pacú" });
    await deleteSpecies(species.id);

    const stored = await db.species.get(species.id);
    expect(stored?.deletedAt).not.toBeNull();

    const active = await listActiveSpecies();
    expect(active).toHaveLength(0);

    const queue = await db.syncQueue.orderBy("createdAt").toArray();
    expect(queue.at(-1)).toMatchObject({ operation: "DELETE", entityId: species.id });
  });

  it("cada registro nuevo lleva el mismo deviceId persistido en localStorage", async () => {
    const a = await createSpecies({ commonName: "Pacú" });
    const b = await createSpecies({ commonName: "Tilapia" });

    expect(a.deviceId).toBe(b.deviceId);
    expect(window.localStorage.getItem("piscicultura:deviceId")).toBe(a.deviceId);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { createPond } from "../repositories/pondRepository";
import {
  createWaterQualityRecord,
  getLatestWaterQualityRecord,
  listWaterQualityRecordsByPond,
} from "../repositories/waterQualityRepository";
import { db } from "../schema";

describe("waterQualityRepository.createWaterQualityRecord", () => {
  let pondId: string;

  beforeEach(async () => {
    await db.ponds.clear();
    await db.waterQualityRecords.clear();
    await db.syncQueue.clear();

    pondId = (await createPond({ code: "E01", name: "Norte" })).id;
    await db.syncQueue.clear();
  });

  it("crea un registro con un solo parámetro medido (§2: mínimo estanque+fecha+un parámetro)", async () => {
    const record = await createWaterQualityRecord({
      pondId,
      date: "2026-09-11T08:00:00.000Z",
      ph: 7.2,
    });

    expect(record.ph).toBe(7.2);
    expect(record.temperatureC).toBeNull();

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0].entityType).toBe("WaterQualityRecord");
  });

  it("rechaza un registro sin ningún parámetro medido", async () => {
    await expect(
      createWaterQualityRecord({ pondId, date: "2026-09-11T08:00:00.000Z" }),
    ).rejects.toThrow(/al menos un parámetro/i);
    expect(await db.waterQualityRecords.count()).toBe(0);
  });

  it("rechaza pH físicamente imposible antes de escribir (§3)", async () => {
    await expect(
      createWaterQualityRecord({ pondId, date: "2026-09-11T08:00:00.000Z", ph: 20 }),
    ).rejects.toThrow(/pH/);
    expect(await db.waterQualityRecords.count()).toBe(0);
  });

  it("getLatestWaterQualityRecord devuelve la medición más reciente del estanque", async () => {
    await createWaterQualityRecord({
      pondId,
      date: "2026-09-10T08:00:00.000Z",
      ph: 7.0,
    });
    await createWaterQualityRecord({
      pondId,
      date: "2026-09-11T08:00:00.000Z",
      ph: 7.3,
    });

    const latest = await getLatestWaterQualityRecord(pondId);
    expect(latest?.ph).toBe(7.3);
  });

  it("listWaterQualityRecordsByPond devuelve solo las mediciones de ese estanque, más recientes primero", async () => {
    const otherPondId = (await createPond({ code: "E02", name: "Sur" })).id;
    await createWaterQualityRecord({ pondId, date: "2026-09-10T08:00:00.000Z", ph: 7.0 });
    await createWaterQualityRecord({ pondId, date: "2026-09-11T08:00:00.000Z", ph: 7.3 });
    await createWaterQualityRecord({ pondId: otherPondId, date: "2026-09-11T08:00:00.000Z", ph: 6.8 });

    const records = await listWaterQualityRecordsByPond(pondId);
    expect(records).toHaveLength(2);
    expect(records[0].ph).toBe(7.3);
    expect(records[1].ph).toBe(7.0);
  });
});

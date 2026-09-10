import { beforeEach, describe, expect, it } from "vitest";

import { createFeed } from "../repositories/feedRepository";
import { getFeedStock } from "../../domain/feedLedger";
import { registerPurchase, updatePurchasePaymentStatus } from "../repositories/purchaseRepository";
import { db } from "../schema";

describe("purchaseRepository", () => {
  beforeEach(async () => {
    await db.feeds.clear();
    await db.feedInventoryMovements.clear();
    await db.purchases.clear();
    await db.purchaseLines.clear();
    await db.syncQueue.clear();
  });

  it("§10-§13 compra de alimento: 20 sacos x 25kg a 190 Bs/saco -> 500kg, 3800 Bs, stock +500kg", async () => {
    const feed = await createFeed({ name: "Crecimiento 32%" });
    const sackCount = 20;
    const weightPerSackKg = 25;
    const pricePerSack = 190;
    const quantityKg = sackCount * weightPerSackKg;
    const unitPrice = pricePerSack / weightPerSackKg;

    const { purchase, lines } = await registerPurchase({
      date: "2026-09-10T00:00:00.000Z",
      lines: [
        {
          itemType: "FEED",
          feedId: feed.id,
          description: feed.name,
          quantity: quantityKg,
          unit: "kg",
          unitPrice,
        },
      ],
    });

    expect(quantityKg).toBe(500);
    expect(purchase.totalAmount).toBeCloseTo(3800, 5);
    expect(lines).toHaveLength(1);
    expect(purchase.paymentStatus).toBe("PENDING");

    const movements = await db.feedInventoryMovements.where("feedId").equals(feed.id).toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe("PURCHASE");
    expect(movements[0].sourceType).toBe("PURCHASE");
    expect(movements[0].sourceId).toBe(lines[0].id);
    expect(getFeedStock(movements, feed.id)).toBe(500);
  });

  it("§60: stock 100kg, compra 500kg -> 600kg", async () => {
    const feed = await createFeed({ name: "Engorde", initialStockKg: 100 });

    await registerPurchase({
      date: "2026-09-10T00:00:00.000Z",
      lines: [
        { itemType: "FEED", feedId: feed.id, description: "Engorde", quantity: 500, unit: "kg", unitPrice: 6 },
      ],
    });

    const movements = await db.feedInventoryMovements.where("feedId").equals(feed.id).toArray();
    expect(getFeedStock(movements, feed.id)).toBe(600);
  });

  it("una compra que no es de alimento nunca genera un movimiento de inventario", async () => {
    const { purchase, lines } = await registerPurchase({
      date: "2026-09-10T00:00:00.000Z",
      lines: [
        { itemType: "MEDICINE", feedId: null, description: "Antiparasitario", quantity: 2, unit: "unidad", unitPrice: 50 },
      ],
    });

    expect(purchase.totalAmount).toBe(100);
    expect(lines[0].feedId).toBeNull();
    expect(await db.feedInventoryMovements.count()).toBe(0);
  });

  it("rechaza una línea de alimento sin feedId", async () => {
    await expect(
      registerPurchase({
        date: "2026-09-10T00:00:00.000Z",
        lines: [{ itemType: "FEED", feedId: null, description: "Alimento", quantity: 10, unit: "kg", unitPrice: 5 }],
      }),
    ).rejects.toThrow(/debe indicar a qué alimento/);
    expect(await db.purchases.count()).toBe(0);
  });

  it("rechaza una compra sin líneas", async () => {
    await expect(registerPurchase({ date: "2026-09-10T00:00:00.000Z", lines: [] })).rejects.toThrow(
      /al menos una línea/,
    );
  });

  it("updatePurchasePaymentStatus: única edición permitida sobre una compra confirmada", async () => {
    const { purchase } = await registerPurchase({
      date: "2026-09-10T00:00:00.000Z",
      lines: [{ itemType: "OTHER", feedId: null, description: "Herramienta", quantity: 1, unit: "unidad", unitPrice: 200 }],
    });

    const updated = await updatePurchasePaymentStatus(purchase.id, "PAID", 200);
    expect(updated.paymentStatus).toBe("PAID");
    expect(updated.amountPaid).toBe(200);
    expect(updated.version).toBe(2);
  });
});

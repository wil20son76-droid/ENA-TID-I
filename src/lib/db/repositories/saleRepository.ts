// Ventas (§27-§32 del encargo de Fase 5): Sale + SaleLine se registran
// como UNA sola operación de negocio atómica ("RegisterSale"), mismo
// criterio que RegisterPurchase/RegisterFeeding — nunca una Sale sin sus
// líneas (§51). Si una línea referencia una cosecha (`harvestId`), los kg
// disponibles de esa cosecha son `kg cosechados - kg ya vendidos` (§30),
// nunca negativos — validado localmente antes de escribir y de nuevo en
// el servidor con lock por `harvestId` (§31, igual criterio que el lock
// por batchId de traslados/mortalidad/cosecha).
import { getDeviceId } from "../deviceId";
import { db } from "../schema";
import type { SaleLineRecord, SaleRecord } from "../types";
import { generateId } from "../uuid";
import { enqueueSyncOperation, updateRecord } from "./base";

const ENTITY_TYPE = "Sale" as const;
const REGISTER_SALE_ENTITY_TYPE = "RegisterSale" as const;

export interface CreateSaleLineInput {
  batchId: string;
  harvestId?: string | null;
  description: string;
  quantityFish?: number | null;
  weightKg: number;
  pricePerKg: number;
}

export interface CreateSaleInput {
  customerId?: string | null;
  date: string;
  notes?: string | null;
  lines: CreateSaleLineInput[];
}

export interface RegisterSaleResult {
  sale: SaleRecord;
  lines: SaleLineRecord[];
}

function lineTotal(line: CreateSaleLineInput): number {
  return Math.round(line.weightKg * line.pricePerKg * 100) / 100;
}

/** Kg ya vendidos de una cosecha (líneas de venta no eliminadas que la referencian). */
export async function getSoldKgForHarvest(harvestId: string): Promise<number> {
  const lines = await db.saleLines.where("harvestId").equals(harvestId).toArray();
  return lines.filter((l) => !l.deletedAt).reduce((sum, l) => sum + l.weightKg, 0);
}

/** Kg disponibles de una cosecha para vender (§30): `kg cosechados - kg ya vendidos`, nunca negativo. */
export async function getAvailableKgForHarvest(harvestId: string): Promise<number> {
  const harvest = await db.harvests.get(harvestId);
  if (!harvest) return 0;
  const sold = await getSoldKgForHarvest(harvestId);
  return Math.max(0, harvest.totalWeightKg - sold);
}

export async function registerSale(input: CreateSaleInput): Promise<RegisterSaleResult> {
  if (input.lines.length === 0) {
    throw new Error("Una venta debe tener al menos una línea.");
  }
  for (const line of input.lines) {
    if (line.weightKg <= 0) throw new Error("El peso vendido de cada línea debe ser mayor que cero.");
    if (line.pricePerKg <= 0) throw new Error("El precio por kg debe ser mayor que cero.");
  }

  // Validación de balance por cosecha ANTES de escribir (§30-§31): se
  // agrupa por harvestId porque una misma venta puede tener varias líneas
  // de la misma cosecha, y la suma de esas líneas tampoco puede superar
  // lo disponible.
  const requestedByHarvest = new Map<string, number>();
  for (const line of input.lines) {
    if (!line.harvestId) continue;
    requestedByHarvest.set(line.harvestId, (requestedByHarvest.get(line.harvestId) ?? 0) + line.weightKg);
  }
  for (const [harvestId, requestedKg] of requestedByHarvest) {
    const available = await getAvailableKgForHarvest(harvestId);
    if (requestedKg > available) {
      throw new Error(
        `No hay suficiente peso disponible de esta cosecha para vender. Disponible: ${available.toLocaleString("es")} kg.`,
      );
    }
  }

  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  const saleId = generateId();

  const lines: SaleLineRecord[] = input.lines.map((line) => ({
    id: generateId(),
    saleId,
    batchId: line.batchId,
    harvestId: line.harvestId ?? null,
    description: line.description,
    quantityFish: line.quantityFish ?? null,
    weightKg: line.weightKg,
    pricePerKg: line.pricePerKg,
    totalAmount: lineTotal(line),
    deviceId,
    createdAt: now,
    deletedAt: null,
  }));

  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.totalAmount, 0) * 100) / 100;

  const sale: SaleRecord = {
    id: saleId,
    customerId: input.customerId ?? null,
    date: input.date,
    paymentStatus: "PENDING",
    amountPaid: 0,
    totalAmount,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    deviceId,
    createdBy: null,
    updatedBy: null,
  };

  const registerSalePayload = {
    id: sale.id,
    customerId: sale.customerId,
    date: sale.date,
    paymentStatus: sale.paymentStatus,
    amountPaid: sale.amountPaid,
    totalAmount: sale.totalAmount,
    notes: sale.notes,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    deletedAt: sale.deletedAt,
    version: sale.version,
    deviceId: sale.deviceId,
    createdBy: sale.createdBy,
    updatedBy: sale.updatedBy,
    lines: lines.map((line) => ({
      id: line.id,
      batchId: line.batchId,
      harvestId: line.harvestId,
      description: line.description,
      quantityFish: line.quantityFish,
      weightKg: line.weightKg,
      pricePerKg: line.pricePerKg,
      totalAmount: line.totalAmount,
    })),
  };

  await db.transaction("rw", db.sales, db.saleLines, db.syncQueue, async () => {
    await db.sales.add(sale);
    await db.saleLines.bulkAdd(lines);
    await enqueueSyncOperation(REGISTER_SALE_ENTITY_TYPE, sale.id, "CREATE", registerSalePayload, deviceId);
  });

  return { sale, lines };
}

export async function listSales(): Promise<SaleRecord[]> {
  const all = await db.sales.toArray();
  return all.filter((s) => !s.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getSaleById(id: string): Promise<SaleRecord | undefined> {
  return db.sales.get(id);
}

export async function listSaleLinesForSale(saleId: string): Promise<SaleLineRecord[]> {
  const all = await db.saleLines.where("saleId").equals(saleId).toArray();
  return all.filter((l) => !l.deletedAt);
}

/** Igual criterio que `updatePurchasePaymentStatus`: única edición permitida sobre una Sale existente. */
export async function updateSalePaymentStatus(
  id: string,
  paymentStatus: SaleRecord["paymentStatus"],
  amountPaid: number,
): Promise<SaleRecord> {
  if (amountPaid < 0) {
    throw new Error("El monto pagado no puede ser negativo.");
  }
  return updateRecord<SaleRecord>(db.sales, ENTITY_TYPE, id, { paymentStatus, amountPaid });
}

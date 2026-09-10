// Mensajes de conflicto legibles por tipo de operación (Fase 3.5 §23 del
// encargo): un conflicto de una operación de negocio compuesta
// (RegisterFeeding, FishTransfer, MortalityRecord, FeedInventoryMovement)
// no es un conflicto de "versión más reciente" (last-write-wins, el único
// caso real para Species/Pond/FishBatch/Feed) — es un conflicto de
// balance/stock: el dato local ya no es válido porque otro dispositivo
// consumió el mismo stock o balance primero. Mostrar el mensaje genérico
// de LWW ahí sería confuso y, para RegisterFeeding en particular, además
// incorrecto: la operación nunca se divide en "Feeding falló" / "Inventory
// falló" — es UN incidente comprensible.
import type { SyncEntityType } from "../db/types";

function readNumber(payload: unknown, field: string): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

function formatKg(value: number): string {
  return `${value.toLocaleString("es")} kg`;
}

function formatCount(value: number): string {
  return `${value.toLocaleString("es")} ${value === 1 ? "pez" : "peces"}`;
}

const GENERIC_VERSION_CONFLICT =
  "Conflicto: el servidor tiene una versión más reciente de este registro.";

/**
 * Mensaje de conflicto para mostrar al usuario, específico de la
 * operación que falló. Nunca expone detalles internos (nombres de tabla,
 * "Feeding" vs "Inventory") — cada operación compuesta se presenta como un
 * único incidente de negocio, tal como se registró como una única entrada
 * de outbox.
 */
export function getConflictMessage(entityType: SyncEntityType, payload: unknown): string {
  switch (entityType) {
    case "RegisterFeeding": {
      const quantityKg = readNumber(payload, "quantityKg");
      return quantityKg != null
        ? `No se pudo sincronizar la alimentación de ${formatKg(quantityKg)} porque el stock disponible cambió desde otro dispositivo.`
        : "No se pudo sincronizar la alimentación porque el stock disponible cambió desde otro dispositivo.";
    }
    case "FeedInventoryMovement": {
      const quantityKg = readNumber(payload, "quantityKg");
      return quantityKg != null
        ? `No se pudo sincronizar el movimiento de inventario de ${formatKg(quantityKg)} porque el stock disponible cambió desde otro dispositivo.`
        : "No se pudo sincronizar el movimiento de inventario porque el stock disponible cambió desde otro dispositivo.";
    }
    case "FishTransfer": {
      const quantity = readNumber(payload, "quantity");
      return quantity != null
        ? `No se pudo sincronizar el traslado de ${formatCount(quantity)} porque el balance del estanque de origen cambió desde otro dispositivo.`
        : "No se pudo sincronizar el traslado porque el balance del estanque de origen cambió desde otro dispositivo.";
    }
    case "MortalityRecord": {
      const quantity = readNumber(payload, "quantity");
      return quantity != null
        ? `No se pudo sincronizar el registro de mortalidad de ${formatCount(quantity)} porque el balance del estanque cambió desde otro dispositivo.`
        : "No se pudo sincronizar el registro de mortalidad porque el balance del estanque cambió desde otro dispositivo.";
    }
    case "Harvest": {
      const quantityFish = readNumber(payload, "quantityFish");
      return quantityFish != null
        ? `No se pudo sincronizar la cosecha de ${formatCount(quantityFish)} porque el balance del estanque cambió desde otro dispositivo.`
        : "No se pudo sincronizar la cosecha porque el balance del estanque cambió desde otro dispositivo.";
    }
    case "RegisterSale":
      return "No se pudo sincronizar la venta porque el peso disponible de la cosecha referenciada cambió desde otro dispositivo.";
    case "Species":
    case "Pond":
    case "FishBatch":
    case "Feed":
    case "Task":
    case "FarmSettings":
    case "Supplier":
    case "Customer":
    case "Purchase":
    case "Sale":
      // Task/FarmSettings/Supplier/Customer/Purchase/Sale son mutables,
      // igual que Species/Pond — su conflicto SÍ es de versión (dos
      // dispositivos editando/pagando el mismo registro offline), así que
      // el mensaje genérico de LWW es correcto aquí.
      return GENERIC_VERSION_CONFLICT;
    // Estas entidades nunca producen "conflict" en el servidor (son
    // append-only vía upsert, o su comando compuesto no valida balance),
    // pero se cubre el caso por completitud/robustez.
    case "Stocking":
    case "FeedingRecord":
    case "Sampling":
    case "CreateFeedWithInitialStock":
    case "WaterQualityRecord":
    case "Expense":
    case "RegisterPurchase":
      return GENERIC_VERSION_CONFLICT;
  }
}

// Costo de inventario de alimento (§14-§16 del encargo de Fase 5): costo
// promedio ponderado histórico. Mismo principio que el resto del dominio
// de esta app — el costo de un consumo NUNCA se guarda como un campo
// mutable ni se recalcula con el precio ACTUAL del catálogo de alimentos
// (eso reescribiría retroactivamente el costo histórico cada vez que
// cambia un precio, violando §14: "los cambios de precio futuros NUNCA
// deben recalcular retroactivamente el costo histórico"). Se deriva
// siempre del historial de FeedInventoryMovement, reproduciendo la regla
// contable con una única función pura, usada igual en cliente y servidor.
//
// Algoritmo (promedio ponderado móvil): cada entrada (PURCHASE,
// INITIAL_STOCK, ADJUSTMENT_IN, RETURN) con `unitCostPerKg` conocido suma
// su cantidad y su valor al inventario; una entrada sin costo conocido
// (dato legado) suma cantidad pero no valor — se documenta como
// limitación, nunca se inventa un precio. Cada salida (CONSUMPTION,
// ADJUSTMENT_OUT, LOSS) se valora al costo promedio ACTUAL (valor total /
// stock) antes de esa salida, y ese promedio no cambia por la salida
// misma — solo las compras futuras lo mueven (§16: verificado con el
// ejemplo del encargo — 100kg×6 + 100kg×8 → promedio 7; un consumo de
// 20kg cuesta 140 y el promedio post-consumo sigue siendo 7).
import { isFeedExitMovement, type FeedMovementType } from "./feedLedger";

export interface FeedCostMovementEntry {
  id: string;
  feedId: string;
  movementType: FeedMovementType;
  quantityKg: number;
  unitCostPerKg: number | null;
  createdAt: string;
}

export interface FeedMovementCostResult {
  id: string;
  /** Costo atribuible a esta salida (0 para entradas: no consumen valor, lo aportan). */
  cost: number;
  /** Costo promedio por kg del inventario DESPUÉS de aplicar este movimiento. */
  averageCostPerKgAfter: number | null;
}

function sortChronologically<T extends { createdAt: string; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Recorre el historial de movimientos de UN alimento en orden cronológico
 * y calcula el costo atribuible a cada salida y el promedio ponderado
 * resultante después de cada movimiento. Es la única fuente de este
 * cálculo — ni la UI ni el servidor deben reimplementarlo.
 */
export function calculateFeedMovementCosts(
  movements: readonly FeedCostMovementEntry[],
  feedId: string,
): FeedMovementCostResult[] {
  const sorted = sortChronologically(movements.filter((m) => m.feedId === feedId));

  let stockKg = 0;
  let totalValue = 0;
  const results: FeedMovementCostResult[] = [];

  for (const movement of sorted) {
    const magnitude = Math.abs(movement.quantityKg);

    if (isFeedExitMovement(movement.movementType)) {
      const averageBefore = stockKg > 0 ? totalValue / stockKg : 0;
      // Nunca se consume más valor del que hay registrado (protege contra
      // desajustes de redondeo acumulados a lo largo de un historial largo).
      const cost = Math.min(averageBefore * magnitude, totalValue);
      stockKg = Math.max(0, stockKg - magnitude);
      totalValue = Math.max(0, totalValue - cost);
      results.push({
        id: movement.id,
        cost,
        averageCostPerKgAfter: stockKg > 0 ? totalValue / stockKg : null,
      });
    } else {
      stockKg += magnitude;
      if (movement.unitCostPerKg != null) {
        totalValue += magnitude * movement.unitCostPerKg;
      }
      results.push({
        id: movement.id,
        cost: 0,
        averageCostPerKgAfter: stockKg > 0 ? totalValue / stockKg : null,
      });
    }
  }

  return results;
}

export interface FeedInventoryValuation {
  stockKg: number;
  totalValue: number;
  /** `null` si no queda stock: no hay un "costo promedio" con nada que valorar. */
  averageCostPerKg: number | null;
}

/** Valoración actual del inventario de un alimento (stock, valor total, costo promedio). */
export function calculateFeedInventoryValuation(
  movements: readonly FeedCostMovementEntry[],
  feedId: string,
): FeedInventoryValuation {
  const sorted = sortChronologically(movements.filter((m) => m.feedId === feedId));

  let stockKg = 0;
  let totalValue = 0;

  for (const movement of sorted) {
    const magnitude = Math.abs(movement.quantityKg);
    if (isFeedExitMovement(movement.movementType)) {
      const averageBefore = stockKg > 0 ? totalValue / stockKg : 0;
      const cost = Math.min(averageBefore * magnitude, totalValue);
      stockKg = Math.max(0, stockKg - magnitude);
      totalValue = Math.max(0, totalValue - cost);
    } else {
      stockKg += magnitude;
      if (movement.unitCostPerKg != null) {
        totalValue += magnitude * movement.unitCostPerKg;
      }
    }
  }

  return {
    stockKg,
    totalValue,
    averageCostPerKg: stockKg > 0 ? totalValue / stockKg : null,
  };
}

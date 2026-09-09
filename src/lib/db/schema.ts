// Base de datos local (IndexedDB vía Dexie). Es la base de datos
// OPERATIVA de la aplicación: toda pantalla lee y escribe aquí primero,
// sin esperar nunca a la red (IMPLEMENTATION_PLAN.md §5).
//
// Importante: este módulo solo debe importarse desde Componentes Cliente
// ("use client"). Construir Dexie fuera del navegador (por ejemplo, si se
// importara accidentalmente desde un Server Component) fallaría porque
// IndexedDB no existe en Node.
import Dexie, { type EntityTable } from "dexie";

import type {
  FishBatchRecord,
  FishTransferRecord,
  PondRecord,
  SpeciesRecord,
  StockingRecord,
  SyncMetaRecord,
  SyncQueueRecord,
} from "./types";

export class AppDatabase extends Dexie {
  species!: EntityTable<SpeciesRecord, "id">;
  ponds!: EntityTable<PondRecord, "id">;
  fishBatches!: EntityTable<FishBatchRecord, "id">;
  stockings!: EntityTable<StockingRecord, "id">;
  fishTransfers!: EntityTable<FishTransferRecord, "id">;
  syncQueue!: EntityTable<SyncQueueRecord, "id">;
  syncMeta!: EntityTable<SyncMetaRecord, "key">;

  constructor() {
    super("piscicultura-db");

    // Historial de versiones del esquema local. Cada entrada nueva debe
    // conservar (o migrar explícitamente) los datos de la anterior: nunca
    // se puede asumir que el dispositivo abre la app por primera vez, ya
    // que puede llevar días/semanas offline con datos sin sincronizar.
    // NUNCA se modifica una versión ya publicada — solo se agregan
    // versiones nuevas (Dexie aplica los upgrades en cadena y conserva lo
    // que ya había).
    this.version(1).stores({
      // Índices: solo se indexan los campos que realmente se consultan
      // (filtros/orden). El resto se recupera por escaneo simple: el
      // volumen de datos de una piscicultura no lo justifica.
      species: "id, active, updatedAt",
      ponds: "id, code, status, updatedAt",
      syncQueue: "id, status, entityType, [entityType+entityId], createdAt",
      syncMeta: "key",
    });

    // Fase 2 (producción): nuevas entidades + un índice nuevo en "ponds"
    // (active). "species" no cambia de índices (los campos técnicos
    // nuevos/renombrados no se consultan por índice), así que no hace
    // falta repetirla aquí — Dexie conserva su definición de la v1.
    this.version(2).stores({
      ponds: "id, code, status, updatedAt, active",
      fishBatches: "id, code, speciesId, status, updatedAt",
      stockings: "id, batchId, pondId, [batchId+pondId], createdAt",
      fishTransfers: "id, batchId, fromPondId, toPondId, createdAt",
    });
  }
}

export const db = new AppDatabase();

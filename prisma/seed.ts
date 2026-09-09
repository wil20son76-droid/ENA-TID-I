// Seed opcional de datos de demostración (§63 del IMPLEMENTATION_PLAN.md,
// Fase 2 §37 del encargo de producción piscícola). Se ejecuta con
// "npm run db:seed" y solo actúa si SEED_DEMO_DATA=true, para no ensuciar
// por accidente una base de datos de producción.
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { calculateBiomassKg } from "../src/lib/domain/biomass";
import { PrismaClient } from "../src/generated/prisma/client";

const SEED_DEVICE_ID = "seed-script";
const DEMO_BATCH_ID = "demo-batch-pac-2026-001";
const DEMO_STOCKING_ID = "demo-stocking-pac-2026-001";

async function main() {
  if (process.env.SEED_DEMO_DATA !== "true") {
    console.log(
      'SEED_DEMO_DATA no está en "true" — no se sembraron datos de demostración.',
    );
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida.");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const species = [
      { commonName: "Pacú", scientificName: "Piaractus mesopotamicus" },
      { commonName: "Tambaquí", scientificName: "Colossoma macropomum" },
      { commonName: "Tilapia", scientificName: "Oreochromis niloticus" },
    ];

    for (const s of species) {
      await prisma.species.upsert({
        where: { id: `demo-species-${s.commonName.toLowerCase()}` },
        update: {},
        create: {
          id: `demo-species-${s.commonName.toLowerCase()}`,
          ...s,
          active: true,
          deviceId: SEED_DEVICE_ID,
        },
      });
    }

    const ponds = ["E01", "E02", "E03", "E04"];
    for (const code of ponds) {
      await prisma.pond.upsert({
        where: { code },
        update: {},
        create: {
          id: randomUUID(),
          code,
          name: `Estanque ${code}`,
          // E01 arranca ocupado porque recibe el lote de demostración; el
          // resto queda vacío hasta que alguien siembre o traslade en él.
          status: code === "E01" ? "ACTIVE" : "EMPTY",
          deviceId: SEED_DEVICE_ID,
        },
      });
    }

    const pondE01 = await prisma.pond.findUniqueOrThrow({ where: { code: "E01" } });
    const initialQuantity = 1000;
    const initialAverageWeightG = 15;
    const initialBiomassKg = calculateBiomassKg(initialQuantity, initialAverageWeightG);
    const initialStockingDate = new Date();

    // Lote + siembra inicial de demostración: código fijo "PAC-2026-001"
    // (no se genera con generateBatchCode porque este seed no corre desde
    // un dispositivo real offline). La siembra es el evento append-only
    // que deja la evidencia histórica — el lote nunca guarda por sí solo
    // en qué estanque está.
    await prisma.fishBatch.upsert({
      where: { code: "PAC-2026-001" },
      update: {},
      create: {
        id: DEMO_BATCH_ID,
        code: "PAC-2026-001",
        speciesId: "demo-species-pacú",
        initialStockingDate,
        initialQuantity,
        initialAverageWeightG,
        initialBiomassKg,
        status: "STOCKED",
        deviceId: SEED_DEVICE_ID,
      },
    });

    await prisma.stocking.upsert({
      where: { id: DEMO_STOCKING_ID },
      update: {},
      create: {
        id: DEMO_STOCKING_ID,
        batchId: DEMO_BATCH_ID,
        pondId: pondE01.id,
        date: initialStockingDate,
        quantity: initialQuantity,
        averageWeightG: initialAverageWeightG,
        biomassKg: initialBiomassKg,
        deviceId: SEED_DEVICE_ID,
      },
    });

    console.log(
      `Datos de demostración sembrados: ${species.length} especies, ${ponds.length} estanques, 1 lote (PAC-2026-001, ${initialQuantity} peces en E01).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Error sembrando datos de demostración:", error);
  process.exitCode = 1;
});

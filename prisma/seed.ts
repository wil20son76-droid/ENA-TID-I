// Seed opcional de datos de demostración (§63 del IMPLEMENTATION_PLAN.md).
// Se ejecuta con "npm run db:seed" y solo actúa si SEED_DEMO_DATA=true,
// para no ensuciar por accidente una base de datos de producción.
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const SEED_DEVICE_ID = "seed-script";

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
          status: "ACTIVE",
          deviceId: SEED_DEVICE_ID,
        },
      });
    }

    console.log(
      `Datos de demostración sembrados: ${species.length} especies, ${ponds.length} estanques.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Error sembrando datos de demostración:", error);
  process.exitCode = 1;
});

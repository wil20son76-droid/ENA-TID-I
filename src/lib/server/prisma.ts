import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 ya no crea el motor de conexión automáticamente: requiere un
// driver adapter explícito (aquí, node-postgres) y no lee DATABASE_URL de
// forma implícita fuera de la CLI. Ver IMPLEMENTATION_PLAN.md §3.3.
//
// Patrón singleton en `globalThis` para evitar abrir un pool de conexiones
// nuevo en cada recarga de módulo durante `next dev` (Fast Refresh/Turbopack).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está definida. Copia .env.example a .env y configúrala.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

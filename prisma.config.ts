// Configuración central del CLI de Prisma 7. Desde v7 la URL de conexión ya
// no vive en "schema.prisma" (ver ese archivo) sino aquí, y las variables de
// entorno ya no se cargan automáticamente: se importan explícitamente con
// dotenv. Ver IMPLEMENTATION_PLAN.md §3.3.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

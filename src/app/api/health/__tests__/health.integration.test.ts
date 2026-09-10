// Prueba de integración de /api/health (Fase 7, §"Health check") contra
// PostgreSQL real — confirma que responde "ok" cuando la base está
// disponible, la condición mínima que Railway consulta para decidir si
// el servicio está saludable.
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/server/prisma";
import { GET as healthHandler } from "../route";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/health", () => {
  it("responde 200 status:ok cuando la base de datos está disponible, sin exigir autenticación", async () => {
    const response = await healthHandler();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.time).toBe("string");
  });
});

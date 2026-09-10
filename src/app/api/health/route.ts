// GET /api/health — healthcheck de Railway (Fase 7, §"Health check").
// Público a propósito (Railway lo consulta sin ningún token) y
// deliberadamente mínimo: solo confirma que el proceso responde Y que
// puede hablar con PostgreSQL — las dos condiciones para que la app sea
// mínimamente funcional. Nunca expone información de diagnóstico
// detallada (nombres de tablas, versión de Postgres, etc.) a un endpoint
// sin autenticación.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", time: new Date().toISOString() });
  } catch (error) {
    logger.error("Healthcheck falló: no se pudo conectar a la base de datos", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}

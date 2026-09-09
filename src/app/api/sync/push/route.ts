// POST /api/sync/push — recibe operaciones pendientes de la cola local
// (outbox) y las aplica de forma idempotente contra PostgreSQL.
//
// Idempotencia (IMPLEMENTATION_PLAN.md §6.5): cada operación trae su
// propio id (el mismo que la entrada de syncQueue en el dispositivo), que
// se guarda como clave única en SyncOperation. Reenviar exactamente la
// misma operación — por un reintento tras un corte de conexión, por
// ejemplo — nunca vuelve a aplicar su efecto: el segundo intento choca
// con la restricción UNIQUE de la base de datos y se responde "duplicate".
import { NextResponse } from "next/server";
import type { z } from "zod";

import { prisma } from "@/lib/server/prisma";
import { pushRequestSchema, pushResultStatusSchema } from "@/lib/validation/sync";
import { applyOperation } from "../_lib/applyOperation";

type PushResultStatus = z.infer<typeof pushResultStatusSchema>;

interface OperationResult {
  id: string;
  status: PushResultStatus;
  error?: string;
}

function isUniqueConstraintOnOperationId(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002" &&
    "meta" in error &&
    !!(error as { meta?: { target?: unknown } }).meta?.target &&
    JSON.stringify((error as { meta?: { target?: unknown } }).meta?.target).includes(
      "operationId",
    )
  );
}

async function processOperation(
  op: z.infer<typeof pushRequestSchema>["operations"][number],
): Promise<OperationResult> {
  const existing = await prisma.syncOperation.findUnique({
    where: { operationId: op.id },
  });

  if (existing) {
    return {
      id: op.id,
      status: existing.status === "applied" ? "duplicate" : existing.status,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const applyResult = await applyOperation(tx, op);
      await tx.syncOperation.create({
        data: {
          operationId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          deviceId: op.deviceId,
          status: applyResult,
        },
      });
      return applyResult;
    });

    return { id: op.id, status: result };
  } catch (error) {
    if (isUniqueConstraintOnOperationId(error)) {
      // Dos solicitudes concurrentes con la misma operación: la que perdió
      // la carrera no aplicó nada (se revirtió la transacción), la que la
      // ganó sí. Se informa como duplicada, nunca como error.
      const applied = await prisma.syncOperation.findUnique({
        where: { operationId: op.id },
      });
      return { id: op.id, status: applied ? "duplicate" : "error" };
    }

    const message = error instanceof Error ? error.message : "Error desconocido";

    // Se registra el intento fallido para diagnóstico (fuera de la
    // transacción que se revirtió) sin bloquear reintentos futuros.
    await prisma.syncOperation
      .upsert({
        where: { operationId: op.id },
        create: {
          operationId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          deviceId: op.deviceId,
          status: "error",
          errorMessage: message,
        },
        update: { status: "error", errorMessage: message },
      })
      .catch(() => undefined);

    return { id: op.id, status: "error", error: message };
  }
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = pushRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud inválida", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Secuencial a propósito: dos operaciones del mismo lote pueden afectar
  // la misma entidad (p. ej. CREATE seguido de una UPDATE offline), y el
  // orden de aplicación debe respetar el orden de envío del dispositivo.
  const results: OperationResult[] = [];
  for (const op of parsed.data.operations) {
    results.push(await processOperation(op));
  }

  return NextResponse.json({ results, serverTime: new Date().toISOString() });
}

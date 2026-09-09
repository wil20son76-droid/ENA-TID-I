// POST /api/sync/push — recibe operaciones pendientes de la cola local
// (outbox) y las aplica de forma idempotente contra PostgreSQL.
//
// Idempotencia (IMPLEMENTATION_PLAN.md §6.5): cada operación trae su
// propio id (el mismo que la entrada de syncQueue en el dispositivo), que
// se guarda como clave única en SyncOperation. Reenviar exactamente la
// misma operación DESPUÉS de que se aplicó con éxito — por un reintento
// tras un corte de conexión, por ejemplo — nunca vuelve a aplicar su
// efecto: se responde "duplicate" sin tocar la base.
//
// Solo "applied" es terminal (Fase 3.5, §3/§13/§22 del encargo de
// hardening — "recuperación después de fallos parciales"): un
// operationId que quedó en "conflict" o "error" NO se trata como
// definitivo. Antes de esta fase, cualquier fila existente en
// SyncOperation (sin importar su estado) cortaba el reintento en seco y
// devolvía siempre el mismo status guardado — así que una operación que
// falló porque su padre todavía no existía (dependencia de sincronización
// no resuelta) o porque el stock/balance no alcanzaba en ese momento
// quedaba bloqueada PARA SIEMPRE, sin importar cuántas veces el motor de
// sync la reintentara: nunca se volvía a ejecutar `applyOperation`. Eso
// contradice directamente el propio requisito de que el orden de sync no
// sustituye al retry (§13) — un reintento que nunca reevalúa nada no es
// un reintento. Ver src/app/api/sync/__tests__/syncOrder.integration.test.ts
// (§22) y OFFLINE_SYNC.md §10 para la prueba y el detalle.
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

  if (existing?.status === "applied") {
    // Único caso realmente terminal: ya se aplicó con éxito, no se vuelve
    // a tocar la base nunca más para este operationId.
    return { id: op.id, status: "duplicate" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const applyResult = await applyOperation(tx, op);
      // `existing` puede ser una fila previa en "conflict"/"error" (un
      // reintento que ahora sí puede resolverse) o no existir todavía
      // (primer intento) — en ambos casos, upsert deja registrado el
      // resultado ACTUAL, nunca uno obsoleto.
      await tx.syncOperation.upsert({
        where: { operationId: op.id },
        create: {
          operationId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          deviceId: op.deviceId,
          status: applyResult,
        },
        update: { status: applyResult, errorMessage: null },
      });
      return applyResult;
    });

    return { id: op.id, status: result };
  } catch (error) {
    if (isUniqueConstraintOnOperationId(error)) {
      // Dos solicitudes concurrentes con la misma operación NUEVA (nunca
      // antes vista): la que perdió la carrera no aplicó nada (se revirtió
      // la transacción), la que la ganó sí. Se informa como duplicada,
      // nunca como error. (Un reintento de una operación YA existente en
      // "conflict"/"error" no puede chocar aquí: usa upsert, no create.)
      const applied = await prisma.syncOperation.findUnique({
        where: { operationId: op.id },
      });
      return { id: op.id, status: applied?.status === "applied" ? "duplicate" : "error" };
    }

    const message = error instanceof Error ? error.message : "Error desconocido";

    // Se registra el intento fallido para diagnóstico (fuera de la
    // transacción que se revirtió) sin bloquear reintentos futuros: la
    // próxima vez que se reenvíe este mismo operationId, `existing?.status`
    // será "error" (no "applied"), así que se vuelve a intentar de verdad.
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

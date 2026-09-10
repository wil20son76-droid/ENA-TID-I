// POST /api/auth/reset-password — segundo paso de la recuperación por
// email (§"Recuperación por email"): consume el token del enlace y fija
// una contraseña nueva. Público (todavía no hay sesión).
//
// Nunca distingue en la respuesta por qué un token es inválido (no
// existe, ya se usó, o expiró) — un único mensaje genérico, mismo
// criterio de no-revelación que forgot-password.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { hashPassword } from "@/lib/auth/password";
import { hashResetToken } from "@/lib/auth/passwordResetTokens";
import { resetPasswordRequestSchema } from "@/lib/validation/auth";

const INVALID_TOKEN_MESSAGE = "El enlace de recuperación es inválido o ya expiró. Solicita uno nuevo.";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = resetPasswordRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Solicitud inválida." },
      { status: 400 },
    );
  }
  const { token, newPassword } = parsed.data;

  const tokenHash = hashResetToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt !== null || resetToken.expiresAt < new Date()) {
    return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: resetToken.userId } });
  if (!user || !user.active) {
    return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(newPassword),
        // Quien pasó por email+token acaba de demostrar control de la
        // cuenta y elige su propia contraseña nueva a propósito — a
        // diferencia del reset por ADMIN (§"Reset por ADMIN"), que asigna
        // una temporal, aquí no hace falta forzar un cambio adicional.
        mustChangePassword: false,
        // Revoca cualquier sesión activa en cualquier dispositivo — la
        // recuperación existe precisamente porque la contraseña anterior
        // se dio por comprometida/perdida.
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  logger.info("Contraseña restablecida vía email", { userId: user.id });

  return NextResponse.json({ message: "Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña." });
}

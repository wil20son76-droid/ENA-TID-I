// POST /api/auth/forgot-password — primer paso de la recuperación por
// email (§"Recuperación por email"). Público a propósito (quien la pide
// todavía no tiene sesión). Requiere red — es, junto con el login mismo,
// la otra única parte de la app que exige conexión (ver SECURITY.md y
// OFFLINE_SYNC.md).
//
// Regla de diseño no negociable: la respuesta es SIEMPRE la misma, exista
// o no una cuenta con ese email — nunca reveles si un correo está
// registrado. Por eso este handler nunca devuelve 404 ni distingue casos
// en el cuerpo de la respuesta.
import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { sendEmail } from "@/lib/server/email";
import { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } from "@/lib/auth/passwordResetTokens";
import { isRateLimited, recordFailedAttempt } from "@/lib/auth/rateLimit";
import { forgotPasswordRequestSchema } from "@/lib/validation/auth";

const GENERIC_RESPONSE = {
  message: "Si el correo existe en el sistema, enviamos un enlace de recuperación.",
};

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = forgotPasswordRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Introduce un correo válido." }, { status: 400 });
  }
  const { email } = parsed.data;

  // Clave con prefijo propio ("forgot:") en el mismo limitador en memoria
  // que /api/auth/login (rateLimit.ts es genérico por diseño) — no hay
  // colisión posible con las claves de login, que son nombres de usuario
  // sin ese prefijo. El límite es por el email introducido, exista o no
  // esa cuenta: alguien probando emails inventados a repetición también
  // queda bloqueado igual, así que el 429 en sí no filtra si la cuenta
  // existe.
  const rateLimitKey = `forgot:${email}`;
  if (isRateLimited(rateLimitKey)) {
    logger.warn("Recuperación de contraseña bloqueada por límite de intentos", { email });
    return NextResponse.json(
      { error: "Demasiadas solicitudes para este correo. Espera unos minutos e intenta de nuevo." },
      { status: 429 },
    );
  }
  recordFailedAttempt(rateLimitKey);

  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.active) {
    const rawToken = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const appUrl = (process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
    const resetLink = `${appUrl}/?resetToken=${rawToken}`;

    await sendEmail({
      to: email,
      subject: "Recupera tu contraseña — ENA TID’I",
      text: `Recibimos una solicitud para restablecer tu contraseña.\n\nSi fuiste tú, abre este enlace (válido por 30 minutos, un solo uso):\n${resetLink}\n\nSi no fuiste tú, ignora este correo — tu contraseña actual sigue funcionando.`,
      html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p><p>Si fuiste tú, abre este enlace (válido por 30 minutos, un solo uso):</p><p><a href="${resetLink}">${resetLink}</a></p><p>Si no fuiste tú, ignora este correo — tu contraseña actual sigue funcionando.</p>`,
    });

    logger.info("Token de recuperación de contraseña generado", { userId: user.id });
  } else {
    // Mismo tiempo/forma de respuesta tanto si no existe la cuenta como si
    // existe pero está desactivada — nunca se distingue ninguno de los
    // dos casos del "sí existe y está activa".
    logger.info("Solicitud de recuperación para un email sin cuenta activa asociada", { email });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}

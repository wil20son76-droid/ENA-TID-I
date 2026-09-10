// Capa de envío de email, desacoplada del proveedor (§"Recuperación por
// email": "no hace falta contratar un proveedor de email ahora... deja la
// integración preparada mediante variables de entorno"). Mismo criterio de
// dependencias mínimas que el resto del proyecto (scrypt en vez de
// bcrypt, HS256 a mano en vez de `jose`, `window.print()` en vez de un
// generador de PDF): en vez de integrar un SDK concreto (SendGrid,
// Postmark, Resend...) que habría que cambiar el día que se elija uno
// real, se expone un webhook HTTP genérico — cualquier proveedor
// transaccional moderno acepta un POST JSON equivalente, así que esto no
// es "programar sin proveedor", es no atarse a uno todavía.
//
// Sin `EMAIL_WEBHOOK_URL` configurada (caso por defecto, incluido todo
// desarrollo local), el correo NUNCA se envía de verdad: se registra en
// el log del servidor con el enlace completo, para que el flujo sea
// probable de punta a punta sin depender de una cuenta de email real.
// **Esto es intencional para desarrollo — en producción, configurar
// `EMAIL_WEBHOOK_URL` es obligatorio para que la recuperación por email
// funcione de verdad** (ver SECURITY.md y .env.example).
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  /** false cuando no hay proveedor configurado (se registró en el log, nunca se envió). */
  sent: boolean;
}

async function sendViaWebhook(message: EmailMessage, webhookUrl: string): Promise<void> {
  const apiKey = process.env.EMAIL_WEBHOOK_API_KEY;
  const from = process.env.EMAIL_FROM || "no-responder@localhost";

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ from, ...message }),
  });

  if (!response.ok) {
    throw new Error(`El webhook de email respondió HTTP ${response.status}.`);
  }
}

/**
 * Nunca lanza por un fallo de envío hacia el llamador de recuperación de
 * contraseña — esa ruta ya responde siempre el mismo mensaje genérico
 * exista o no la cuenta (§"no revelar si el email existe"); si el envío
 * fallara y SÍ propagara el error, la diferencia de comportamiento
 * (200 vs 500) filtraría exactamente esa información. El fallo se
 * registra igualmente para que sea visible en los logs de Railway.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.warn("Email no enviado: EMAIL_WEBHOOK_URL no está configurada (registrado aquí en su lugar)", {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return { sent: false };
  }

  try {
    await sendViaWebhook(message, webhookUrl);
    logger.info("Email enviado", { to: message.to, subject: message.subject });
    return { sent: true };
  } catch (error) {
    logger.error("No se pudo enviar el email", error, { to: message.to, subject: message.subject });
    return { sent: false };
  }
}

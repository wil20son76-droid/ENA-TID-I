// Logger de producción (Fase 7, §"Logs y manejo de errores de
// producción"). Deliberadamente NO es una librería (pino/winston): un
// wrapper mínimo que imprime JSON de una línea a stdout/stderr — Railway
// (como la mayoría de PaaS) captura stdout/stderr directamente como logs,
// sin que haga falta un transporte propio ni un servicio externo nuevo
// (mismo criterio de "no dependencias innecesarias" que el resto del
// proyecto). El formato JSON hace que cada línea sea fácil de filtrar/
// buscar en el panel de logs de Railway sin herramientas adicionales.
//
// Nunca se registra una contraseña, hash o token completo — ver
// SECURITY.md. `error()` acepta el objeto Error para incluir su mensaje y
// stack (útil en desarrollo/diagnóstico), pero el endpoint que lo llama
// decide qué le contesta al cliente (nunca el stack trace crudo, §51).
type LogLevel = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, error?: unknown, fields?: LogFields) {
    const errorFields =
      error instanceof Error
        ? { errorMessage: error.message, errorStack: error.stack }
        : error !== undefined
          ? { errorValue: String(error) }
          : {};
    write("error", message, { ...errorFields, ...fields });
  },
};

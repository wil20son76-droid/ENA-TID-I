// Esquemas Zod para el protocolo de autenticación (Fase 7) — mismo
// criterio que src/lib/validation/sync.ts: el servidor nunca confía en
// que el cliente ya validó, revalida siempre aquí.
import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "MANAGER", "WORKER", "READ_ONLY"]);

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const createUserRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo puede tener letras, números, puntos, guiones y guiones bajos."),
  name: z.string().trim().min(1).max(150),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
  role: userRoleSchema,
});

export const updateUserRequestSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200).optional(),
  revokeSessions: z.boolean().optional(),
});

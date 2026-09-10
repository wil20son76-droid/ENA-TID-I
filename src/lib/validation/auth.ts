// Esquemas Zod para el protocolo de autenticación (Fase 7) — mismo
// criterio que src/lib/validation/sync.ts: el servidor nunca confía en
// que el cliente ya validó, revalida siempre aquí.
import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "MANAGER", "WORKER", "READ_ONLY"]);

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Email opcional en minúsculas (búsqueda case-insensitive en recuperación
// por email, ver prisma/schema.prisma modelo User) — z.email() ya normaliza
// el formato pero no el case, por eso el .transform explícito.
const optionalEmailSchema = z
  .union([z.literal(""), z.string().trim().toLowerCase().email().max(200)])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const createUserRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres.")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo puede tener letras, números, puntos, guiones y guiones bajos."),
  name: z.string().trim().min(1).max(150),
  email: optionalEmailSchema,
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
  role: userRoleSchema,
});

export const updateUserRequestSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  email: optionalEmailSchema,
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200).optional(),
  revokeSessions: z.boolean().optional(),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(10).max(500),
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
});

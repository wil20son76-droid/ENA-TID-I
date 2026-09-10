// Bootstrap del primer usuario ADMIN (Fase 7, §"Autenticación inicial").
// Se ejecuta UNA VEZ tras el primer despliegue (o cuando haga falta
// recuperar acceso perdido): nunca hay una contraseña de administrador
// hardcodeada en el código ni sembrada automáticamente por
// `npm run db:seed` (§"No guardar secretos en frontend"/backend — ver
// SECURITY.md). Crear el primer admin es siempre un paso manual
// explícito, con una contraseña que decide quien despliega.
//
// Uso:
//   ADMIN_USERNAME=admin ADMIN_NAME="Nombre Apellido" ADMIN_PASSWORD="clave-fuerte" npm run auth:create-admin
//
// Si el usuario ya existe, actualiza su contraseña y lo deja como ADMIN
// activo (permite recuperar acceso si se perdió la contraseña) y revoca
// cualquier sesión previa (`tokenVersion` incrementado) — nunca crea una
// segunda cuenta con el mismo nombre de usuario.
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { hashPassword } from "../src/lib/auth/password";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const name = process.env.ADMIN_NAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !name || !password) {
    console.error(
      'Uso: ADMIN_USERNAME=admin ADMIN_NAME="Nombre Apellido" ADMIN_PASSWORD="clave-fuerte" npm run auth:create-admin',
    );
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("ADMIN_PASSWORD debe tener al menos 8 caracteres.");
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida.");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const passwordHash = hashPassword(password);
    const user = await prisma.user.upsert({
      where: { username },
      create: { username, name, passwordHash, role: "ADMIN", active: true },
      update: {
        name,
        passwordHash,
        role: "ADMIN",
        active: true,
        tokenVersion: { increment: 1 },
      },
    });
    console.log(`Usuario ADMIN listo: "${user.username}" (id ${user.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

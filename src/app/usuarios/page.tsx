"use client";

// Gestión de usuarios y roles (Fase 7, §"Roles básicos"). Solo ADMIN.
// Deliberadamente online-only: habla directo contra /api/users (nunca
// contra Dexie/syncQueue) — ver la nota del modelo User en
// prisma/schema.prisma y SECURITY.md para el porqué.
import { useEffect, useState } from "react";

import { RequireCapability } from "@/components/auth/RequireCapability";
import { ROLE_LABEL, type UserRole } from "@/lib/auth/permissions";
import { createUser, listUsers, updateUser, type AdminUser } from "@/lib/auth/usersApi";

const ROLE_OPTIONS: UserRole[] = ["ADMIN", "MANAGER", "WORKER", "READ_ONLY"];

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900";

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca";
  return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("WORKER");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function reload() {
    try {
      setUsers(await listUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la lista de usuarios (¿hay conexión? esta pantalla no funciona offline).",
      );
    }
  }

  useEffect(() => {
    // Carga inicial contra la API (nunca contra Dexie — ver comentario del
    // módulo): es la sincronización legítima con un sistema externo que
    // useEffect existe para resolver, no un efecto derivado de estado de
    // React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await createUser({ username, name, password, role });
      setUsername("");
      setName("");
      setPassword("");
      setRole("WORKER");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo crear el usuario.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      await updateUser(user.id, { active: !user.active });
      await reload();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo actualizar el usuario.");
    }
  }

  async function handleRevoke(user: AdminUser) {
    try {
      await updateUser(user.id, { revokeSessions: true });
      await reload();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo revocar la sesión.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Usuarios</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Gestión de cuentas y roles — requiere conexión. Nunca pasa por la cola de sincronización
          offline (ver SECURITY.md).
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Nuevo usuario</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Usuario</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Nombre</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Contraseña temporal (mínimo 8 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
            minLength={8}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Rol</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            disabled={submitting}
            className={inputClass}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        {formError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creando…" : "Crear usuario"}
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Cuentas existentes</h3>
        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {loadError}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Último acceso</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((user) => (
                <tr key={user.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{user.username}</td>
                  <td className="px-3 py-2">{user.name}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[user.role]}</td>
                  <td className="px-3 py-2">{user.active ? "Activo" : "Inactivo"}</td>
                  <td className="px-3 py-2">{formatDate(user.lastLoginAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(user)}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-600 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        {user.active ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevoke(user)}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        Cerrar sesiones
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users !== null && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                    Sin usuarios todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  return (
    <RequireCapability capability="MANAGE_USERS">
      <UsersAdmin />
    </RequireCapability>
  );
}

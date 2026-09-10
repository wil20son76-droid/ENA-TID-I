"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import type { CustomerType } from "@/lib/db/types";
import {
  createCustomer,
  deactivateCustomer,
  listAllCustomers,
} from "@/lib/db/repositories/customerRepository";

const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  INDIVIDUAL: "Particular",
  RESTAURANT: "Restaurante",
  MARKET: "Mercado",
  DISTRIBUTOR: "Distribuidor",
  WHOLESALER: "Mayorista",
  OTHER: "Otro",
};

export default function CustomersPage() {
  const customers = useLiveQuery(() => listAllCustomers(), []) ?? [];

  const [name, setName] = useState("");
  const [type, setType] = useState<CustomerType>("INDIVIDUAL");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Escribe el nombre del cliente.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createCustomer({
        name: trimmed,
        type,
        phone: phone.trim() || null,
        whatsapp: null,
        locality: null,
        address: null,
        notes: null,
        active: true,
      });
      setName("");
      setPhone("");
      setType("INDIVIDUAL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Clientes</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Compradores del pescado producido (§6-§7).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="customerName" className="text-sm font-medium">
          Nuevo cliente
        </label>
        <input
          id="customerName"
          type="text"
          placeholder="Nombre"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
          autoComplete="off"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as CustomerType)}
            disabled={submitting}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(Object.keys(CUSTOMER_TYPE_LABEL) as CustomerType[]).map((key) => (
              <option key={key} value={key}>
                {CUSTOMER_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Teléfono (opcional)"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded-lg bg-emerald-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Agregar
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {customers.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Todavía no hay clientes registrados.
          </li>
        )}
        {customers.map((customer) => (
          <li
            key={customer.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <p className="font-medium">{customer.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {CUSTOMER_TYPE_LABEL[customer.type]}
                {customer.phone ? ` · ${customer.phone}` : ""}
                {!customer.active && (
                  <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    Inactivo
                  </span>
                )}
              </p>
            </div>
            {customer.active && (
              <button
                type="button"
                onClick={() => void deactivateCustomer(customer.id)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Desactivar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

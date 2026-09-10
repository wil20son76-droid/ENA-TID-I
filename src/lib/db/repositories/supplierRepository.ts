import { db } from "../schema";
import type { SupplierFields, SupplierRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Supplier" as const;

export async function listActiveSuppliers(): Promise<SupplierRecord[]> {
  const all = await db.suppliers.toArray();
  return all
    .filter((s) => !s.deletedAt && s.active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function listAllSuppliers(): Promise<SupplierRecord[]> {
  const all = await db.suppliers.toArray();
  return all.filter((s) => !s.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function getSupplierById(id: string): Promise<SupplierRecord | undefined> {
  return db.suppliers.get(id);
}

export async function createSupplier(input: SupplierFields): Promise<SupplierRecord> {
  if (!input.name.trim()) {
    throw new Error("El nombre del proveedor es obligatorio.");
  }
  return createRecord<SupplierRecord>(db.suppliers, ENTITY_TYPE, input);
}

export async function updateSupplier(
  id: string,
  patch: Partial<SupplierFields>,
): Promise<SupplierRecord> {
  return updateRecord<SupplierRecord>(db.suppliers, ENTITY_TYPE, id, patch);
}

export async function deactivateSupplier(id: string): Promise<SupplierRecord> {
  return updateRecord<SupplierRecord>(db.suppliers, ENTITY_TYPE, id, { active: false });
}

export async function deleteSupplier(id: string): Promise<void> {
  return softDeleteRecord<SupplierRecord>(db.suppliers, ENTITY_TYPE, id);
}

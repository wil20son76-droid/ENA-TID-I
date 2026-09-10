import { db } from "../schema";
import type { CustomerFields, CustomerRecord } from "../types";
import { createRecord, softDeleteRecord, updateRecord } from "./base";

const ENTITY_TYPE = "Customer" as const;

export async function listActiveCustomers(): Promise<CustomerRecord[]> {
  const all = await db.customers.toArray();
  return all
    .filter((c) => !c.deletedAt && c.active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function listAllCustomers(): Promise<CustomerRecord[]> {
  const all = await db.customers.toArray();
  return all.filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function getCustomerById(id: string): Promise<CustomerRecord | undefined> {
  return db.customers.get(id);
}

export async function createCustomer(input: CustomerFields): Promise<CustomerRecord> {
  if (!input.name.trim()) {
    throw new Error("El nombre del cliente es obligatorio.");
  }
  return createRecord<CustomerRecord>(db.customers, ENTITY_TYPE, input);
}

export async function updateCustomer(
  id: string,
  patch: Partial<CustomerFields>,
): Promise<CustomerRecord> {
  return updateRecord<CustomerRecord>(db.customers, ENTITY_TYPE, id, patch);
}

export async function deactivateCustomer(id: string): Promise<CustomerRecord> {
  return updateRecord<CustomerRecord>(db.customers, ENTITY_TYPE, id, { active: false });
}

export async function deleteCustomer(id: string): Promise<void> {
  return softDeleteRecord<CustomerRecord>(db.customers, ENTITY_TYPE, id);
}

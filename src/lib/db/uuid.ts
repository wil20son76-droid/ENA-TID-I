// Generación de identificadores en el dispositivo (§6E del encargo de
// Fase 1, IMPLEMENTATION_PLAN.md §5.3, principio P3). Nunca se depende de
// IDs autoincrementales del servidor: toda entidad sincronizable nace con
// su UUID definitivo en el cliente.
export function generateId(): string {
  return crypto.randomUUID();
}

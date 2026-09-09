// Textos en español para enums de dominio, centralizados para no repetir
// el mapeo en cada pantalla que los muestra (§15/§8 del encargo de Fase 3).
import type { FeedingShift, MortalityCause } from "./db/types";

export const MORTALITY_CAUSE_LABEL: Record<MortalityCause, string> = {
  UNKNOWN: "Desconocida",
  LOW_OXYGEN: "Bajo oxígeno",
  DISEASE: "Enfermedad",
  HANDLING: "Manejo",
  PREDATORS: "Depredadores",
  TEMPERATURE: "Temperatura",
  WATER_QUALITY: "Calidad del agua",
  ACCIDENT: "Accidente",
  OTHER: "Otra",
};

export const FEEDING_SHIFT_LABEL: Record<FeedingShift, string> = {
  MORNING: "Mañana",
  MIDDAY: "Mediodía",
  AFTERNOON: "Tarde",
  NIGHT: "Noche",
};

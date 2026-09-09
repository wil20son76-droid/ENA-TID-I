// Textos en español para enums de dominio, centralizados para no repetir
// el mapeo en cada pantalla que los muestra (§15/§8 del encargo de Fase 3).
import type { FeedingShift, MortalityCause, TaskPriority, TaskStatus } from "./db/types";
import type { WaterQualitySeverity } from "./domain/waterQuality";

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

// --- Fase 4: calidad del agua, tareas ---

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Pendiente",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Baja",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

/** Nunca solo color (§46 del encargo de Fase 4 — accesibilidad obligatoria). */
export const WATER_QUALITY_SEVERITY_LABEL: Record<WaterQualitySeverity, string> = {
  info: "Info",
  warning: "⚠ Advertencia",
  critical: "❗ Crítico",
};

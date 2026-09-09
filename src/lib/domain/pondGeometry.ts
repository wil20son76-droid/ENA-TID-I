// Lógica de área/volumen del estanque: calculado vs manual (§4 del
// encargo de Fase 2).
//
// Regla: mientras el área/volumen esté en modo "CALCULATED", cambiar
// largo/ancho/profundidad recalcula automáticamente. En cuanto la persona
// edita el área o el volumen directamente, ese campo pasa a modo "MANUAL"
// y deja de recalcularse solo — así nunca se sobrescribe en silencio un
// valor que alguien introdujo a mano porque el estanque no es
// perfectamente rectangular (§4: "no sobrescribirla automáticamente sin
// avisar"). El "aviso" es que la UI muestra explícitamente qué campos
// están en modo manual, con un botón para volver a modo calculado
// (src/app/estanques/PondGeometryFields.tsx).
//
// Son funciones puras: toman el estado geométrico actual + un parche con
// lo que la persona acaba de cambiar, y devuelven el nuevo estado
// completo (valores + qué modo quedó cada campo). Se usan igual al crear
// un estanque nuevo (estado inicial con todo en null/"CALCULATED") que al
// editar uno existente. Los nombres de campo coinciden 1:1 con
// prisma/schema.prisma y src/lib/db/types.ts (PondFields).

export type GeometrySource = "CALCULATED" | "MANUAL";

export interface PondGeometryState {
  lengthM: number | null;
  widthM: number | null;
  averageDepthM: number | null;
  areaM2: number | null;
  areaSource: GeometrySource;
  estimatedVolumeM3: number | null;
  volumeSource: GeometrySource;
}

export type PondGeometryPatch = Partial<
  Pick<
    PondGeometryState,
    "lengthM" | "widthM" | "averageDepthM" | "areaM2" | "estimatedVolumeM3"
  >
>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aplica un cambio de geometría respetando el modo calculado/manual de
 * cada campo. Nunca lanza: si faltan datos para calcular algo, ese campo
 * simplemente queda como estaba (o en null si tampoco había valor previo).
 */
export function applyPondGeometryPatch(
  current: PondGeometryState,
  patch: PondGeometryPatch,
): PondGeometryState {
  const next: PondGeometryState = { ...current, ...patch };

  // El área pasó a modo manual si la persona la tocó directamente en este
  // mismo cambio; si no, conserva el modo que ya tenía.
  next.areaSource = "areaM2" in patch ? "MANUAL" : current.areaSource;
  next.volumeSource = "estimatedVolumeM3" in patch ? "MANUAL" : current.volumeSource;

  const lengthOrWidthChanged = "lengthM" in patch || "widthM" in patch;
  if (next.areaSource === "CALCULATED" && (lengthOrWidthChanged || current.areaM2 === null)) {
    next.areaM2 =
      next.lengthM !== null && next.widthM !== null
        ? round2(next.lengthM * next.widthM)
        : next.areaM2;
  }

  const areaOrDepthChanged = lengthOrWidthChanged || "averageDepthM" in patch;
  if (
    next.volumeSource === "CALCULATED" &&
    (areaOrDepthChanged || current.estimatedVolumeM3 === null)
  ) {
    next.estimatedVolumeM3 =
      next.areaM2 !== null && next.averageDepthM !== null
        ? round2(next.areaM2 * next.averageDepthM)
        : next.estimatedVolumeM3;
  }

  return next;
}

/** Vuelve a poner un campo en modo calculado y lo recalcula ya mismo. */
export function resetToCalculated(
  current: PondGeometryState,
  field: "area" | "volume",
): PondGeometryState {
  if (field === "area") {
    const areaM2 =
      current.lengthM !== null && current.widthM !== null
        ? round2(current.lengthM * current.widthM)
        : null;
    return { ...current, areaSource: "CALCULATED", areaM2 };
  }

  const estimatedVolumeM3 =
    current.areaM2 !== null && current.averageDepthM !== null
      ? round2(current.areaM2 * current.averageDepthM)
      : null;
  return { ...current, volumeSource: "CALCULATED", estimatedVolumeM3 };
}

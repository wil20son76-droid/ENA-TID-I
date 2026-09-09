import { describe, expect, it } from "vitest";

import { applyPondGeometryPatch, resetToCalculated, type PondGeometryState } from "../pondGeometry";

const EMPTY: PondGeometryState = {
  lengthM: null,
  widthM: null,
  averageDepthM: null,
  areaM2: null,
  areaSource: "CALCULATED",
  estimatedVolumeM3: null,
  volumeSource: "CALCULATED",
};

describe("pondGeometry", () => {
  it("calcula el área a partir de largo × ancho", () => {
    const next = applyPondGeometryPatch(EMPTY, { lengthM: 20, widthM: 30 });
    expect(next.areaM2).toBe(600);
    expect(next.areaSource).toBe("CALCULATED");
  });

  it("calcula el volumen a partir de área × profundidad", () => {
    let state = applyPondGeometryPatch(EMPTY, { lengthM: 20, widthM: 30 });
    state = applyPondGeometryPatch(state, { averageDepthM: 1.5 });
    expect(state.estimatedVolumeM3).toBe(900);
    expect(state.volumeSource).toBe("CALCULATED");
  });

  it("editar el área manualmente la pasa a modo manual y ya no se recalcula sola", () => {
    let state = applyPondGeometryPatch(EMPTY, { lengthM: 20, widthM: 30 }); // area = 600
    state = applyPondGeometryPatch(state, { areaM2: 550 }); // estanque no rectangular
    expect(state.areaM2).toBe(550);
    expect(state.areaSource).toBe("MANUAL");

    // Cambiar las medidas después NO debe sobrescribir el área manual.
    state = applyPondGeometryPatch(state, { lengthM: 25 });
    expect(state.areaM2).toBe(550);
    expect(state.areaSource).toBe("MANUAL");
  });

  it("el volumen manual tampoco se sobrescribe si luego cambia el área", () => {
    let state = applyPondGeometryPatch(EMPTY, { lengthM: 20, widthM: 30, averageDepthM: 1.5 });
    state = applyPondGeometryPatch(state, { estimatedVolumeM3: 850 });
    expect(state.volumeSource).toBe("MANUAL");

    state = applyPondGeometryPatch(state, { widthM: 32 });
    expect(state.areaM2).toBe(640); // el área SÍ se recalculó (sigue en "CALCULATED")
    expect(state.estimatedVolumeM3).toBe(850); // el volumen manual no se tocó
  });

  it("resetToCalculated vuelve a derivar el área desde las medidas", () => {
    let state = applyPondGeometryPatch(EMPTY, { lengthM: 20, widthM: 30 });
    state = applyPondGeometryPatch(state, { areaM2: 999 });
    expect(state.areaSource).toBe("MANUAL");

    state = resetToCalculated(state, "area");
    expect(state.areaSource).toBe("CALCULATED");
    expect(state.areaM2).toBe(600);
  });

  it("sin largo/ancho, el área queda en null sin lanzar error", () => {
    const state = applyPondGeometryPatch(EMPTY, { averageDepthM: 1.2 });
    expect(state.areaM2).toBeNull();
    expect(state.estimatedVolumeM3).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  buildBatchSpeciesIndex,
  hasActiveFilters,
  isWithinDateRange,
  matchesBatch,
  matchesEventFilters,
  matchesPond,
  matchesSpecies,
} from "../filters";

describe("filters", () => {
  it("isWithinDateRange: inclusivo en ambos extremos", () => {
    expect(isWithinDateRange("2026-03-15T10:00:00.000Z", { dateFrom: "2026-03-15", dateTo: "2026-03-15" })).toBe(true);
    expect(isWithinDateRange("2026-03-14T23:59:00.000Z", { dateFrom: "2026-03-15" })).toBe(false);
    expect(isWithinDateRange("2026-03-16T00:00:00.000Z", { dateTo: "2026-03-15" })).toBe(false);
    expect(isWithinDateRange("2026-03-15T00:00:00.000Z", {})).toBe(true);
  });

  it("matchesBatch/matchesPond: sin filtro activo, todo pasa", () => {
    expect(matchesBatch("b-1", {})).toBe(true);
    expect(matchesBatch("b-1", { batchId: "b-2" })).toBe(false);
    expect(matchesBatch("b-1", { batchId: "b-1" })).toBe(true);
    expect(matchesPond(null, {})).toBe(true);
    expect(matchesPond(null, { pondId: "p-1" })).toBe(false);
  });

  it("buildBatchSpeciesIndex + matchesSpecies", () => {
    const index = buildBatchSpeciesIndex([
      { id: "b-1", speciesId: "sp-1" },
      { id: "b-2", speciesId: "sp-2" },
    ]);
    expect(matchesSpecies("b-1", index, { speciesId: "sp-1" })).toBe(true);
    expect(matchesSpecies("b-2", index, { speciesId: "sp-1" })).toBe(false);
    expect(matchesSpecies(null, index, { speciesId: "sp-1" })).toBe(false);
    expect(matchesSpecies("b-1", index, {})).toBe(true);
  });

  it("matchesEventFilters combina fecha + lote + estanque + especie", () => {
    const index = buildBatchSpeciesIndex([{ id: "b-1", speciesId: "sp-1" }]);
    const event = { date: "2026-03-15T00:00:00.000Z", batchId: "b-1", pondId: "p-1" };
    expect(matchesEventFilters(event, index, { dateFrom: "2026-03-01", speciesId: "sp-1" })).toBe(true);
    expect(matchesEventFilters(event, index, { pondId: "p-2" })).toBe(false);
    expect(matchesEventFilters(event, index, { speciesId: "sp-2" })).toBe(false);
  });

  it("hasActiveFilters", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ batchId: "b-1" })).toBe(true);
  });
});

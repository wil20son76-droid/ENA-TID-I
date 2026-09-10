import { describe, expect, it } from "vitest";

import { toCsv, type CsvColumn } from "../csv";

interface Row {
  name: string;
  amount: number;
  notes: string | null;
}

const columns: CsvColumn<Row>[] = [
  { key: "name", label: "Nombre", value: (r) => r.name },
  { key: "amount", label: "Importe", value: (r) => r.amount },
  { key: "notes", label: "Notas", value: (r) => r.notes },
];

describe("csv", () => {
  it("serializa filas con encabezado y BOM UTF-8", () => {
    const csv = toCsv<Row>([{ name: "Pacú", amount: 100, notes: null }], columns);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿Nombre,Importe,Notas");
    expect(lines[1]).toBe("Pacú,100,");
  });

  it("escapa comas, comillas y saltos de línea (RFC 4180)", () => {
    const csv = toCsv<Row>(
      [{ name: 'Cliente "VIP", S.A.', amount: 50, notes: "Línea 1\nLínea 2" }],
      columns,
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"Cliente ""VIP"", S.A.",50,"Línea 1\nLínea 2"');
  });

  it("sin filas: solo el encabezado", () => {
    const csv = toCsv<Row>([], columns);
    expect(csv).toBe("﻿Nombre,Importe,Notas");
  });
});

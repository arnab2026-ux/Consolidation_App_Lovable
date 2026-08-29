import * as XLSX from "xlsx";

/**
 * Posting-level sets behind the report selectors (decision D5).
 *
 * Local-currency figures live at 00/01. Group-currency figures live at 05 and
 * above and nowhere else, because reported rows carry amount_gc = 0 - so a
 * group-currency report has to include 05 or it returns zero.
 */
export const LEVEL_SETS = {
  REPORTED: ["00"],
  ADJUSTED: ["00", "01"],
  CONSOLIDATED: ["00", "01", "05", "10", "20", "30"],
} as const;

export type LevelSetKey = keyof typeof LEVEL_SETS;

export const LEVEL_SET_OPTIONS: { value: LevelSetKey; label: string }[] = [
  { value: "REPORTED", label: "Reported only" },
  { value: "ADJUSTED", label: "Reported + adjustments" },
  { value: "CONSOLIDATED", label: "Fully consolidated" },
];

export const UNIT_OPTIONS = [
  { value: "1", label: "Units" },
  { value: "1000", label: "Thousands" },
  { value: "1000000", label: "Millions" },
];

/**
 * Right-aligned, thousands-separated, negatives in parentheses — the project's
 * number rule, applied everywhere a figure is shown.
 */
export function money(value: number | null | undefined, divisor = 1, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  const scaled = value / divisor;
  if (scaled === 0) return "—";
  const formatted = Math.abs(scaled).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return scaled < 0 ? `(${formatted})` : formatted;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(1)}%`;
}

/** Variance as a percentage of the comparison figure, guarding divide-by-zero. */
export function variancePct(current: number, compare: number): number | null {
  if (!compare) return null;
  return ((current - compare) / Math.abs(compare)) * 100;
}

export interface SheetSpec {
  name: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
}

/**
 * Writes one or more sheets with a bold header row and the header frozen, so a
 * long statement stays readable when it is scrolled.
 */
export function exportXlsx(filename: string, sheets: SheetSpec[]): void {
  const book = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const data = sheet.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of sheet.columns) {
        const raw = row[col.key];
        out[col.label] = raw === null || raw === undefined ? "" : raw;
      }
      return out;
    });

    const ws = XLSX.utils.json_to_sheet(data, {
      header: sheet.columns.map((c) => c.label),
    });

    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!cols"] = sheet.columns.map((c) => ({ wch: Math.max(12, c.label.length + 2) }));

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r: 0, c });
      const cell = ws[address];
      if (cell) cell.s = { font: { bold: true } };
    }

    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }

  XLSX.writeFile(book, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

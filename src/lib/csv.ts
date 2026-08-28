import Papa from "papaparse";

export interface CsvColumn<T> {
  key: string;
  label: string;
  value?: (row: T) => unknown;
}

export function exportCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
      out[col.label] = raw === null || raw === undefined ? "" : raw;
    }
    return out;
  });
  const csv = Papa.unparse(data, { columns: columns.map((c) => c.label) });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export type CsvRow = Record<string, string>;

export function parseCsvFile(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => resolve(result.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""))),
      error: (error) => reject(error),
    });
  });
}

export function pick(row: CsvRow, ...names: string[]): string {
  for (const name of names) {
    const hit = Object.keys(row).find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (hit) return String(row[hit] ?? "").trim();
  }
  return "";
}

export function parseBool(raw: string, fallback = false): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "x", "ja"].includes(v);
}

export function parseNum(raw: string): number | null {
  const v = raw.replace(/,/g, ".").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse a clipboard TSV/CSV blob pasted from Excel into a 2-D matrix. */
export function parseClipboardMatrix(text: string): string[][] {
  const delimiter = text.includes("\t") ? "\t" : ",";
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

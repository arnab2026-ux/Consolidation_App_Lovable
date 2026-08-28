import Papa from "papaparse";
import * as XLSX from "xlsx";

export type SourceRow = Record<string, string>;

export interface ParsedFile {
  fileName: string;
  kind: "CSV" | "XLSX";
  delimiter: string;
  encoding: string;
  sheetName: string | null;
  columns: string[];
  rows: SourceRow[];
}

function decode(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, ""), encoding: "UTF-8 (BOM)" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "UTF-16 LE" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "Windows-1252" };
  }
}

function normaliseRows(columns: string[], rows: SourceRow[]): SourceRow[] {
  return rows
    .map((row) => {
      const out: SourceRow = {};
      for (const column of columns) out[column] = String(row[column] ?? "").trim();
      return out;
    })
    .filter((row) => Object.values(row).some((value) => value !== ""));
}

/** Read a dropped CSV or XLSX file into a column list plus string rows. */
export async function parseUploadFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const isExcel = /\.(xlsx|xlsm|xls)$/i.test(file.name);

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0] ?? "";
    const sheet = workbook.Sheets[sheetName];
    const grid = sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][])
      : [];
    const header = (grid[0] ?? []).map((cell, index) => String(cell ?? "").trim() || `Column ${index + 1}`);
    const rows = grid.slice(1).map((line) => {
      const row: SourceRow = {};
      header.forEach((name, index) => {
        row[name] = String(line[index] ?? "").trim();
      });
      return row;
    });
    return {
      fileName: file.name,
      kind: "XLSX",
      delimiter: "n/a (workbook)",
      encoding: "n/a (binary workbook)",
      sheetName,
      columns: header,
      rows: normaliseRows(header, rows),
    };
  }

  const { text, encoding } = decode(buffer);
  const result = Papa.parse<SourceRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header, index) => header.trim() || `Column ${index + 1}`,
  });
  const columns = (result.meta.fields ?? []).filter((field) => field !== "");
  return {
    fileName: file.name,
    kind: "CSV",
    delimiter: result.meta.delimiter === "\t" ? "\\t (tab)" : result.meta.delimiter,
    encoding,
    sheetName: null,
    columns,
    rows: normaliseRows(columns, result.data),
  };
}

/** Parse a spreadsheet amount, tolerating thousands separators and trailing minus. */
export function parseAmount(raw: string): number | null {
  let value = raw.replace(/\s|\u00a0/g, "").replace(/^\((.*)\)$/, "-$1");
  if (value === "") return null;
  if (/-$/.test(value)) value = `-${value.slice(0, -1)}`;
  const hasComma = value.includes(",");
  const hasDot = value.includes(".");
  if (hasComma && hasDot) {
    value = value.lastIndexOf(",") > value.lastIndexOf(".")
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  } else if (hasComma) {
    value = /,\d{3}$/.test(value) ? value.replace(/,/g, "") : value.replace(",", ".");
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

import type { DimensionRegistryRow } from "@/hooks/use-active-dimensions";

export type PostingLevel = "01" | "30";

export const POSTING_LEVELS: { value: PostingLevel; label: string }[] = [
  { value: "01", label: "01 — Entity level" },
  { value: "30", label: "30 — Group level" },
];

export interface JournalDimensionColumn {
  key: string;
  label: string;
  /** true when the column maps to a `zdimNN` generic dimension. */
  generic: boolean;
  /** dim_code of the generic dimension, used to look up member lists. */
  dimCode?: string;
}

const CORE_COLUMNS: JournalDimensionColumn[] = [
  { key: "entity_code", label: "Entity", generic: false },
  { key: "account_code", label: "Account", generic: false },
  { key: "movement_code", label: "Movement", generic: false },
  { key: "partner_code", label: "Partner", generic: false },
];

/** Grid columns: fixed dimensions plus every active `dim_registry` dimension. */
export function journalDimensionColumns(dimensions: DimensionRegistryRow[]): JournalDimensionColumn[] {
  const generic = dimensions
    .filter((dim) => dim.is_active && dim.physical_column.startsWith("zdim"))
    .map<JournalDimensionColumn>((dim) => ({
      key: dim.physical_column,
      label: dim.dim_name,
      generic: true,
      dimCode: dim.dim_code,
    }));
  return [...CORE_COLUMNS, ...generic];
}

export interface JournalLine {
  key: string;
  values: Record<string, string>;
  debit: string;
  credit: string;
  amountTc: string;
  transactionCurrency: string;
}

export function emptyLine(): JournalLine {
  return {
    key: crypto.randomUUID(),
    values: {},
    debit: "",
    credit: "",
    amountTc: "",
    transactionCurrency: "",
  };
}

export function toNumber(raw: string): number {
  const value = Number(raw.replace(/[\s,]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Line amount in local currency: debit positive, credit negative. */
export function lineAmountLc(line: JournalLine): number {
  return round2(toNumber(line.debit) - toNumber(line.credit));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface JournalTotals {
  debit: number;
  credit: number;
  difference: number;
  balanced: boolean;
}

export function journalTotals(lines: JournalLine[]): JournalTotals {
  const debit = round2(lines.reduce((sum, line) => sum + toNumber(line.debit), 0));
  const credit = round2(lines.reduce((sum, line) => sum + toNumber(line.credit), 0));
  const difference = round2(debit - credit);
  return { debit, credit, difference, balanced: difference === 0 && (debit !== 0 || credit !== 0) };
}

export interface JournalIssue {
  line: number;
  message: string;
}

/** UI-side counterpart of the posting-level rules enforced by the database trigger. */
export function validateJournal(
  lines: JournalLine[],
  postingLevel: PostingLevel,
  consGroupId: string | null,
): JournalIssue[] {
  const issues: JournalIssue[] = [];
  if (postingLevel === "30" && !consGroupId) {
    issues.push({ line: 0, message: "Posting level 30 requires a consolidation group in the point of view" });
  }
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.values["entity_code"]) issues.push({ line: lineNo, message: "Entity is required" });
    if (!line.values["account_code"]) issues.push({ line: lineNo, message: "Account is required" });
    if (toNumber(line.debit) === 0 && toNumber(line.credit) === 0) {
      issues.push({ line: lineNo, message: "Enter a debit or a credit amount" });
    }
    if (toNumber(line.debit) !== 0 && toNumber(line.credit) !== 0) {
      issues.push({ line: lineNo, message: "Enter either a debit or a credit, not both" });
    }
  });
  return issues;
}

export interface JournalLinePayload extends Record<string, string | number | null> {
  entity_code: string;
  account_code: string;
  amount_lc: number;
}

export function buildLinePayload(
  lines: JournalLine[],
  columns: JournalDimensionColumn[],
): JournalLinePayload[] {
  return lines.map((line) => {
    const amountLc = lineAmountLc(line);
    const payload: Record<string, string | number | null> = {
      amount_lc: amountLc,
      amount_tc: line.amountTc === "" ? amountLc : round2(toNumber(line.amountTc)),
      transaction_currency: line.transactionCurrency
        ? line.transactionCurrency.trim().toUpperCase().slice(0, 3)
        : null,
    };
    for (const column of columns) {
      payload[column.key] = line.values[column.key] || null;
    }
    return payload as JournalLinePayload;
  });
}

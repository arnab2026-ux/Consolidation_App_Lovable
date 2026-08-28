import type { DimensionRegistryRow } from "@/hooks/use-active-dimensions";
import { parseAmount, type SourceRow } from "@/lib/upload-parse";

export type TargetKind = "dimension" | "amount" | "currency";

export interface TargetField {
  /** Stable key used in the persisted column/value maps. */
  key: string;
  label: string;
  /** Physical `stg_upload` column the value is written to. */
  column: string;
  kind: TargetKind;
  required: boolean;
}

/** Core dimensions always exist in the staging table, whatever the model. */
const CORE_TARGETS: TargetField[] = [
  { key: "ENTITY", label: "Entity", column: "entity_code", kind: "dimension", required: true },
  { key: "ACCOUNT", label: "Account", column: "account_code", kind: "dimension", required: true },
  { key: "MOVEMENT", label: "Movement Type", column: "movement_code", kind: "dimension", required: false },
  { key: "PARTNER", label: "Partner", column: "partner_code", kind: "dimension", required: false },
];

const VALUE_TARGETS: TargetField[] = [
  { key: "AMOUNT_LC", label: "Amount LC", column: "amount_lc", kind: "amount", required: true },
  { key: "AMOUNT_TC", label: "Amount TC", column: "amount_tc", kind: "amount", required: false },
  {
    key: "TRANSACTION_CURRENCY",
    label: "Transaction Currency",
    column: "transaction_currency",
    kind: "currency",
    required: false,
  },
];

/**
 * Mapping targets for the active model: core dimensions, every active optional
 * dimension (in `display_order`, from `dim_registry`), then the value columns.
 */
export function buildTargets(dimensions: DimensionRegistryRow[]): TargetField[] {
  const optional = dimensions
    .filter((dim) => dim.is_active && dim.physical_column.startsWith("zdim"))
    .map<TargetField>((dim) => ({
      key: dim.dim_code,
      label: dim.dim_name,
      column: dim.physical_column,
      kind: "dimension",
      required: false,
    }));
  return [...CORE_TARGETS, ...optional, ...VALUE_TARGETS];
}

export interface MappingState {
  /** target key → source file column */
  columnMap: Record<string, string>;
  /** target key → { source value: target code } */
  valueMap: Record<string, Record<string, string>>;
  /** target key → constant value used when nothing is mapped */
  defaultValues: Record<string, string>;
  signFlip: boolean;
  splitDebitCredit: boolean;
  debitColumn: string;
  creditColumn: string;
}

export const emptyMapping: MappingState = {
  columnMap: {},
  valueMap: {},
  defaultValues: {},
  signFlip: false,
  splitDebitCredit: false,
  debitColumn: "",
  creditColumn: "",
};

/** Best-effort auto-match of source columns to targets by normalised name. */
export function autoMap(columns: string[], targets: TargetField[]): Record<string, string> {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {};
  for (const target of targets) {
    const candidates = [target.key, target.label, target.column].map(norm);
    const hit = columns.find((column) => candidates.includes(norm(column)));
    if (hit) map[target.key] = hit;
  }
  return map;
}

export interface StagingRow {
  row_no: number;
  raw: SourceRow;
  entity_code: string | null;
  account_code: string | null;
  movement_code: string | null;
  partner_code: string | null;
  amount_lc: number | null;
  amount_tc: number | null;
  transaction_currency: string | null;
  [zdim: string]: unknown;
}

function translate(mapping: MappingState, key: string, value: string): string {
  const table = mapping.valueMap[key];
  if (!table) return value;
  return table[value] ?? value;
}

export interface MappingIssue {
  target: string;
  message: string;
}

/** Targets that must resolve to either a column or a constant before staging. */
export function validateMapping(mapping: MappingState, targets: TargetField[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const target of targets) {
    if (!target.required) continue;
    if (target.key === "AMOUNT_LC" && mapping.splitDebitCredit) {
      if (!mapping.debitColumn && !mapping.creditColumn) {
        issues.push({ target: target.label, message: "Select a debit and/or credit column" });
      }
      continue;
    }
    const mapped = mapping.columnMap[target.key];
    const constant = mapping.defaultValues[target.key];
    if (!mapped && !constant) {
      issues.push({ target: target.label, message: "Map a source column or set a constant value" });
    }
  }
  return issues;
}

/** Convert source rows into `stg_upload` payloads using the mapping. */
export function buildStagingRows(
  rows: SourceRow[],
  targets: TargetField[],
  mapping: MappingState,
): StagingRow[] {
  const sign = mapping.signFlip ? -1 : 1;

  return rows.map((row, index) => {
    const staged: StagingRow = {
      row_no: index + 1,
      raw: row,
      entity_code: null,
      account_code: null,
      movement_code: null,
      partner_code: null,
      amount_lc: null,
      amount_tc: null,
      transaction_currency: null,
    };

    for (const target of targets) {
      const source = mapping.columnMap[target.key];
      const constant = mapping.defaultValues[target.key] ?? "";
      const rawValue = source ? (row[source] ?? "") : "";
      const value = rawValue !== "" ? rawValue : constant;

      if (target.kind === "amount") {
        if (target.key === "AMOUNT_LC" && mapping.splitDebitCredit) continue;
        const amount = value === "" ? null : parseAmount(value);
        staged[target.column] = amount === null ? null : amount * sign;
        continue;
      }
      if (target.kind === "currency") {
        staged[target.column] = value ? value.trim().toUpperCase().slice(0, 3) : null;
        continue;
      }
      staged[target.column] = value ? translate(mapping, target.key, value) : null;
    }

    if (mapping.splitDebitCredit) {
      const debit = mapping.debitColumn ? parseAmount(row[mapping.debitColumn] ?? "") : null;
      const credit = mapping.creditColumn ? parseAmount(row[mapping.creditColumn] ?? "") : null;
      staged["amount_lc"] =
        debit === null && credit === null ? null : ((debit ?? 0) - (credit ?? 0)) * sign;
    }

    return staged;
  });
}

/** Distinct source values for a dimension target, for the translation grid. */
export function distinctSourceValues(rows: SourceRow[], column: string, limit = 200): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    if (value) seen.add(value);
    if (seen.size >= limit) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

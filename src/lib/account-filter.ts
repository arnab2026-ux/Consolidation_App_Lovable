/** Shape of the `jsonb` account filter stored on rule tables. */
export interface AccountCondition {
  field: string;
  operator: string;
  value: string | string[] | null;
}

export interface AccountFilter {
  op: "AND" | "OR";
  conditions: AccountCondition[];
}

export const ACCOUNT_FILTER_FIELDS = [
  { value: "code", label: "Account code", kind: "text" as const },
  { value: "name", label: "Account name", kind: "text" as const },
  { value: "statement_type", label: "Statement type", kind: "list" as const, options: ["BS", "PL", "OCI", "CF", "STAT"] },
  {
    value: "account_class",
    label: "Account class",
    kind: "list" as const,
    options: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "STATISTICAL"],
  },
  { value: "normal_balance", label: "Normal balance", kind: "list" as const, options: ["D", "C"] },
  {
    value: "translation_method",
    label: "Translation method",
    kind: "list" as const,
    options: ["CLOSING", "AVERAGE", "HISTORICAL", "NONE"],
  },
  { value: "elimination_group", label: "Elimination group", kind: "text" as const },
  { value: "is_intercompany", label: "Intercompany flag", kind: "bool" as const },
  { value: "is_equity_account", label: "Equity flag", kind: "bool" as const },
  { value: "is_retained_earnings", label: "Retained earnings flag", kind: "bool" as const },
  { value: "is_net_income", label: "Net income flag", kind: "bool" as const },
];

export const TEXT_OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "contains", label: "contains" },
];

export const LIST_OPERATORS = [
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is not one of" },
];

export const BOOL_OPERATORS = [
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" },
];

export function fieldKind(field: string): "text" | "list" | "bool" {
  return ACCOUNT_FILTER_FIELDS.find((f) => f.value === field)?.kind ?? "text";
}

export function operatorsFor(field: string) {
  const kind = fieldKind(field);
  if (kind === "bool") return BOOL_OPERATORS;
  if (kind === "list") return LIST_OPERATORS;
  return TEXT_OPERATORS;
}

export function emptyFilter(): AccountFilter {
  return { op: "AND", conditions: [] };
}

/** Tolerant read of whatever is stored in the jsonb column. */
export function parseAccountFilter(raw: unknown): AccountFilter {
  if (!raw || typeof raw !== "object") return emptyFilter();
  const value = raw as { op?: unknown; conditions?: unknown };
  const op = value.op === "OR" ? "OR" : "AND";
  const conditions = Array.isArray(value.conditions)
    ? value.conditions
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
        .map((c) => ({
          field: typeof c["field"] === "string" ? c["field"] : "code",
          operator: typeof c["operator"] === "string" ? c["operator"] : "eq",
          value: Array.isArray(c["value"])
            ? (c["value"] as unknown[]).map(String)
            : typeof c["value"] === "string"
              ? c["value"]
              : null,
        }))
    : [];
  return { op, conditions };
}

export function describeCondition(condition: AccountCondition): string {
  const field = ACCOUNT_FILTER_FIELDS.find((f) => f.value === condition.field);
  const operator = operatorsFor(condition.field).find((o) => o.value === condition.operator);
  const value = Array.isArray(condition.value) ? condition.value.join(", ") : (condition.value ?? "");
  return `${field?.label ?? condition.field} ${operator?.label ?? condition.operator}${value ? ` ${value}` : ""}`;
}

export function describeAccountFilter(raw: unknown): string {
  const filter = parseAccountFilter(raw);
  if (filter.conditions.length === 0) return "All active accounts";
  return filter.conditions.map(describeCondition).join(filter.op === "OR" ? " OR " : " AND ");
}

/** Strip empty conditions before writing to the database. */
export function serializeAccountFilter(filter: AccountFilter): AccountFilter | null {
  const conditions = filter.conditions.filter((c) => {
    if (fieldKind(c.field) === "bool") return true;
    if (Array.isArray(c.value)) return c.value.length > 0;
    return Boolean(c.value && c.value.trim());
  });
  if (conditions.length === 0) return null;
  return { op: filter.op, conditions };
}

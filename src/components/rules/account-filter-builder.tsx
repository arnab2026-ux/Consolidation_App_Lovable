import { Plus, Trash2 } from "lucide-react";

import { MultiSelect } from "@/components/multi-select";
import { SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCOUNT_FILTER_FIELDS,
  fieldKind,
  operatorsFor,
  type AccountCondition,
  type AccountFilter,
} from "@/lib/account-filter";

/** Visual condition builder writing the `jsonb` account filter of a rule. */
export function AccountFilterBuilder({
  value,
  onChange,
  matchCount,
}: {
  value: AccountFilter;
  onChange: (next: AccountFilter) => void;
  matchCount?: number | null;
}) {
  function update(index: number, patch: Partial<AccountCondition>) {
    onChange({
      ...value,
      conditions: value.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  }

  function remove(index: number) {
    onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) });
  }

  function add() {
    onChange({ ...value, conditions: [...value.conditions, { field: "code", operator: "starts_with", value: "" }] });
  }

  return (
    <div className="rounded border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Match</span>
          <div className="w-24">
            <SelectField
              value={value.op}
              onChange={(v) => onChange({ ...value, op: v === "OR" ? "OR" : "AND" })}
              options={[
                { value: "AND", label: "all (AND)" },
                { value: "OR", label: "any (OR)" },
              ]}
            />
          </div>
          <span>of the conditions</span>
        </div>
        {typeof matchCount === "number" && (
          <span className="text-xs text-muted-foreground">{matchCount} account(s) match</span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-2">
        {value.conditions.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">No conditions — all active accounts are carried forward.</p>
        )}
        {value.conditions.map((condition, index) => {
          const kind = fieldKind(condition.field);
          const definition = ACCOUNT_FILTER_FIELDS.find((f) => f.value === condition.field);
          return (
            <div key={index} className="flex items-center gap-2">
              <div className="w-44">
                <SelectField
                  value={condition.field}
                  onChange={(field) => {
                    const nextKind = fieldKind(field);
                    update(index, {
                      field,
                      operator: operatorsFor(field)[0]?.value ?? "eq",
                      value: nextKind === "list" ? [] : nextKind === "bool" ? null : "",
                    });
                  }}
                  options={ACCOUNT_FILTER_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
                />
              </div>
              <div className="w-36">
                <SelectField
                  value={condition.operator}
                  onChange={(operator) => update(index, { operator })}
                  options={operatorsFor(condition.field)}
                />
              </div>
              <div className="flex-1">
                {kind === "bool" ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : kind === "list" ? (
                  <MultiSelect
                    label="Values"
                    className="w-full"
                    options={(definition?.options ?? []).map((o) => ({ value: o, label: o }))}
                    selected={Array.isArray(condition.value) ? condition.value : []}
                    onChange={(values) => update(index, { value: values })}
                  />
                ) : (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Value"
                    value={typeof condition.value === "string" ? condition.value : ""}
                    onChange={(e) => update(index, { value: e.target.value })}
                  />
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => remove(index)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
            <Plus className="mr-1 size-3.5" /> Add condition
          </Button>
        </div>
      </div>
    </div>
  );
}

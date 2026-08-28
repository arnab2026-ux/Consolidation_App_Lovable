import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Field, SelectField } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { untyped, unwrap } from "@/lib/supabase-untyped";
import {
  buildStagingRows,
  distinctSourceValues,
  validateMapping,
  type MappingState,
  type TargetField,
} from "@/lib/upload-mapping";
import type { ParsedFile } from "@/lib/upload-parse";

export interface UploadMappingTemplate {
  id: string;
  code: string;
  name: string;
  column_map: MappingState["columnMap"];
  value_map: MappingState["valueMap"];
  default_values: Record<string, string>;
}

const UNMAPPED = "__none__";

export function StepMapping({
  tenantId,
  parsed,
  targets,
  mapping,
  onChange,
  onBack,
  onNext,
}: {
  tenantId: string;
  parsed: ParsedFile;
  targets: TargetField[];
  mapping: MappingState;
  onChange: (next: MappingState) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const queryClient = useQueryClient();
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [templateCode, setTemplateCode] = useState("");
  const [templateName, setTemplateName] = useState("");

  const columnOptions = useMemo(
    () => [{ value: UNMAPPED, label: "— not mapped —" }, ...parsed.columns.map((c) => ({ value: c, label: c }))],
    [parsed.columns],
  );

  const templates = useQuery({
    queryKey: ["upload_mapping", tenantId],
    queryFn: async () =>
      (await unwrap(
        untyped.from("upload_mapping").select<UploadMappingTemplate[]>("*").order("code"),
      )) ?? [],
  });

  const saveTemplate = useMutation({
    mutationFn: async () => {
      if (!templateCode.trim() || !templateName.trim()) throw new Error("Template code and name are required");
      await unwrap(
        untyped.from("upload_mapping").upsert(
          {
            tenant_id: tenantId,
            code: templateCode.trim().toUpperCase(),
            name: templateName.trim(),
            column_map: {
              ...mapping.columnMap,
              __options: {
                signFlip: mapping.signFlip,
                splitDebitCredit: mapping.splitDebitCredit,
                debitColumn: mapping.debitColumn,
                creditColumn: mapping.creditColumn,
              },
            },
            value_map: mapping.valueMap,
            default_values: mapping.defaultValues,
          },
          { onConflict: "tenant_id,code" },
        ),
      );
    },
    onSuccess: () => {
      toast.success("Mapping template saved");
      void queryClient.invalidateQueries({ queryKey: ["upload_mapping"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function loadTemplate(id: string) {
    const template = (templates.data ?? []).find((row) => row.id === id);
    if (!template) return;
    const stored = template.column_map as Record<string, unknown>;
    const options = (stored["__options"] ?? {}) as Partial<MappingState>;
    const columnMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (key === "__options") continue;
      if (typeof value === "string" && parsed.columns.includes(value)) columnMap[key] = value;
    }
    onChange({
      columnMap,
      valueMap: template.value_map ?? {},
      defaultValues: template.default_values ?? {},
      signFlip: Boolean(options.signFlip),
      splitDebitCredit: Boolean(options.splitDebitCredit),
      debitColumn: typeof options.debitColumn === "string" ? options.debitColumn : "",
      creditColumn: typeof options.creditColumn === "string" ? options.creditColumn : "",
    });
    setTemplateCode(template.code);
    setTemplateName(template.name);
    toast.success(`Loaded mapping ${template.code}`);
  }

  const issues = validateMapping(mapping, targets);
  const preview = buildStagingRows(parsed.rows.slice(0, 5), targets, mapping);
  const mappedCount = targets.filter((t) => mapping.columnMap[t.key] || mapping.defaultValues[t.key]).length;

  const activeField = targets.find((target) => target.key === activeTarget) ?? null;
  const activeColumn = activeField ? (mapping.columnMap[activeField.key] ?? "") : "";
  const activeValues = activeColumn ? distinctSourceValues(parsed.rows, activeColumn) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded border p-2">
        <div className="w-56">
          <Field label="Load template">
            <SelectField
              value={null}
              onChange={loadTemplate}
              placeholder={templates.isLoading ? "Loading…" : "Select mapping"}
              options={(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Code">
            <Input className="h-8 text-xs" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} />
          </Field>
        </div>
        <div className="w-56">
          <Field label="Name">
            <Input className="h-8 text-xs" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={saveTemplate.isPending}
          onClick={() => saveTemplate.mutate()}
        >
          <Save className="mr-1 size-3.5" /> Save template
        </Button>
        <div className="ml-auto flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={mapping.signFlip} onCheckedChange={(v) => onChange({ ...mapping, signFlip: v })} />
            Flip sign
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={mapping.splitDebitCredit}
              onCheckedChange={(v) => onChange({ ...mapping, splitDebitCredit: v })}
            />
            Debit / credit columns
          </label>
        </div>
      </div>

      {mapping.splitDebitCredit && (
        <div className="flex flex-wrap items-end gap-2 rounded border p-2">
          <div className="w-56">
            <Field label="Debit column" hint="amount_lc = debit − credit">
              <SelectField
                value={mapping.debitColumn || null}
                onChange={(v) => onChange({ ...mapping, debitColumn: v === UNMAPPED ? "" : v })}
                options={columnOptions}
              />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Credit column">
              <SelectField
                value={mapping.creditColumn || null}
                onChange={(v) => onChange({ ...mapping, creditColumn: v === UNMAPPED ? "" : v })}
                options={columnOptions}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-xs">Target</TableHead>
                <TableHead className="h-8 text-xs">Source column</TableHead>
                <TableHead className="h-8 text-xs">Constant / default</TableHead>
                <TableHead className="h-8 w-24 text-xs">Values</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((target) => {
                const source = mapping.columnMap[target.key] ?? "";
                const translations = Object.keys(mapping.valueMap[target.key] ?? {}).length;
                const isAmountLc = target.key === "AMOUNT_LC" && mapping.splitDebitCredit;
                return (
                  <TableRow key={target.key} className={activeTarget === target.key ? "bg-muted" : undefined}>
                    <TableCell className="py-1 text-xs">
                      <span className="font-medium">{target.label}</span>
                      {target.required && <span className="ml-1 text-destructive">*</span>}
                      <span className="ml-2 text-muted-foreground">{target.column}</span>
                    </TableCell>
                    <TableCell className="py-1">
                      {isAmountLc ? (
                        <span className="text-xs text-muted-foreground">computed from debit − credit</span>
                      ) : (
                        <SelectField
                          value={source || null}
                          onChange={(value) => {
                            const next = { ...mapping.columnMap };
                            if (value === UNMAPPED) delete next[target.key];
                            else next[target.key] = value;
                            onChange({ ...mapping, columnMap: next });
                          }}
                          options={columnOptions}
                        />
                      )}
                    </TableCell>
                    <TableCell className="py-1">
                      <Input
                        className="h-8 text-xs"
                        placeholder={target.kind === "dimension" ? "e.g. #" : ""}
                        value={mapping.defaultValues[target.key] ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...mapping,
                            defaultValues: { ...mapping.defaultValues, [target.key]: event.target.value },
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="py-1">
                      {target.kind === "dimension" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!source}
                          onClick={() => setActiveTarget(target.key === activeTarget ? null : target.key)}
                        >
                          Translate{translations > 0 ? ` (${translations})` : ""}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-2 rounded border p-2">
          <p className="text-xs font-medium">
            {activeField ? `Value translation · ${activeField.label}` : "Value translation"}
          </p>
          {!activeField && (
            <p className="text-xs text-muted-foreground">
              Pick “Translate” on a mapped dimension to map source codes onto master-data codes.
            </p>
          )}
          {activeField && (
            <div className="flex max-h-80 flex-col gap-1 overflow-auto">
              {activeValues.length === 0 && (
                <p className="text-xs text-muted-foreground">No distinct values in the source column.</p>
              )}
              {activeValues.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-xs" title={value}>
                    {value}
                  </span>
                  <Input
                    className="h-7 text-xs"
                    placeholder="target code"
                    value={mapping.valueMap[activeField.key]?.[value] ?? ""}
                    onChange={(event) => {
                      const table = { ...(mapping.valueMap[activeField.key] ?? {}) };
                      if (event.target.value) table[value] = event.target.value;
                      else delete table[value];
                      onChange({
                        ...mapping,
                        valueMap: { ...mapping.valueMap, [activeField.key]: table },
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto rounded border">
        <p className="border-b px-2 py-1 text-xs font-medium">Mapped preview · first 5 rows</p>
        <Table>
          <TableHeader>
            <TableRow>
              {targets.map((target) => (
                <TableHead key={target.key} className="h-8 whitespace-nowrap text-xs">
                  {target.column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((row) => (
              <TableRow key={row.row_no}>
                {targets.map((target) => (
                  <TableCell key={target.key} className="whitespace-nowrap py-1 text-xs">
                    {String(row[target.column] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-[11px]">
          {mappedCount} of {targets.length} targets resolved
        </Badge>
        {issues.map((issue) => (
          <span key={issue.target} className="text-xs text-destructive">
            {issue.target}: {issue.message}
          </span>
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onBack}>
            Back
          </Button>
          <Button size="sm" className="h-8" disabled={issues.length > 0} onClick={onNext}>
            Continue to validation
          </Button>
        </div>
      </div>
    </div>
  );
}

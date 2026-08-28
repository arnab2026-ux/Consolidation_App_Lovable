import { useMutation } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportCsv } from "@/lib/csv";
import { untyped, unwrap } from "@/lib/supabase-untyped";
import { buildStagingRows, type MappingState, type TargetField } from "@/lib/upload-mapping";
import type { ParsedFile } from "@/lib/upload-parse";

export interface ValidationResult {
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors_by_type: { error_code: string; row_count: number; rows: number[] }[];
  trial_balance: { entity_code: string | null; sum_lc: number; balanced: boolean }[];
}

const ERROR_LABELS: Record<string, string> = {
  ENTITY_MISSING: "Entity code missing",
  ENTITY_UNKNOWN: "Entity not in master data",
  ACCOUNT_MISSING: "Account code missing",
  ACCOUNT_UNKNOWN: "Account not in master data",
  MOVEMENT_UNKNOWN: "Movement type not in master data",
  MOVEMENT_REQUIRED: "Movement type required by account",
  PARTNER_UNKNOWN: "Partner entity not in master data",
  PARTNER_REQUIRED: "Partner required by account",
  AMOUNT_MISSING: "Amount LC missing or not numeric",
  CURRENCY_MISMATCH: "Transaction currency differs from entity local currency",
  DUPLICATE_KEY: "Duplicate composite key in the file",
};

export function StepValidate({
  tenantId,
  batchId,
  parsed,
  targets,
  mapping,
  result,
  onResult,
  onBack,
  onNext,
  blocked,
}: {
  tenantId: string;
  batchId: string;
  parsed: ParsedFile;
  targets: TargetField[];
  mapping: MappingState;
  result: ValidationResult | null;
  onResult: (result: ValidationResult) => void;
  onBack: () => void;
  onNext: () => void;
  blocked: boolean;
}) {
  const run = useMutation({
    mutationFn: async () => {
      const rows = buildStagingRows(parsed.rows, targets, mapping);
      await unwrap(untyped.from("stg_upload").delete().eq("batch_id", batchId));
      const payload = rows.map((row) => ({ ...row, tenant_id: tenantId, batch_id: batchId, status: "PENDING" }));
      for (let index = 0; index < payload.length; index += 500) {
        await unwrap(untyped.from("stg_upload").insert(payload.slice(index, index + 500)));
      }
      const validation = await unwrap(
        untyped.rpc<ValidationResult>("validate_upload_batch", { p_batch_id: batchId }),
      );
      if (!validation) throw new Error("Validation returned no result");
      return validation;
    },
    onSuccess: (validation) => {
      onResult(validation);
      toast.success(`${validation.valid_rows} valid, ${validation.error_rows} in error`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function exportErrors() {
    if (!result) return;
    const rows = result.errors_by_type.flatMap((group) =>
      group.rows.map((rowNo) => ({
        row_no: rowNo,
        error_code: group.error_code,
        error: ERROR_LABELS[group.error_code] ?? group.error_code,
      })),
    );
    exportCsv(
      `upload-errors-${batchId.slice(0, 8)}.csv`,
      [
        { key: "row_no", label: "Row" },
        { key: "error_code", label: "Error code" },
        { key: "error", label: "Error" },
      ],
      rows,
    );
  }

  const balanced = (result?.trial_balance ?? []).every((entry) => entry.balanced);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={run.isPending || blocked} onClick={() => run.mutate()}>
          <ShieldCheck className="mr-1 size-3.5" />
          {run.isPending ? "Validating…" : result ? "Re-run validation" : "Stage & validate"}
        </Button>
        {result && result.error_rows > 0 && (
          <Button variant="outline" size="sm" className="h-8" onClick={exportErrors}>
            <Download className="mr-1 size-3.5" /> Download errors as CSV
          </Button>
        )}
      </div>

      {result && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Headline label="Total rows" value={result.total_rows} />
            <Headline label="Valid" value={result.valid_rows} />
            <Headline label="Errors" value={result.error_rows} tone={result.error_rows > 0 ? "bad" : "good"} />
            <Headline
              label="Trial balance"
              value={balanced ? "Pass" : "Fail"}
              tone={balanced ? "good" : "bad"}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-auto rounded border">
              <p className="border-b px-2 py-1 text-xs font-medium">Errors by type</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Error</TableHead>
                    <TableHead className="h-8 w-16 text-xs">Rows</TableHead>
                    <TableHead className="h-8 text-xs">Row numbers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.errors_by_type.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-2 text-xs text-muted-foreground">
                        No validation errors.
                      </TableCell>
                    </TableRow>
                  )}
                  {result.errors_by_type.map((group) => (
                    <TableRow key={group.error_code}>
                      <TableCell className="py-1 text-xs">
                        {ERROR_LABELS[group.error_code] ?? group.error_code}
                      </TableCell>
                      <TableCell className="py-1 text-xs">{group.row_count}</TableCell>
                      <TableCell className="py-1 text-xs text-muted-foreground">
                        {group.rows.slice(0, 25).join(", ")}
                        {group.rows.length > 25 ? " …" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-auto rounded border">
              <p className="border-b px-2 py-1 text-xs font-medium">Trial balance check by entity</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Entity</TableHead>
                    <TableHead className="h-8 text-right text-xs">Sum amount LC</TableHead>
                    <TableHead className="h-8 w-20 text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.trial_balance.map((entry) => (
                    <TableRow key={entry.entity_code ?? "—"}>
                      <TableCell className="py-1 text-xs">{entry.entity_code ?? "—"}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">
                        {Number(entry.sum_lc).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="py-1">
                        <Badge variant={entry.balanced ? "outline" : "destructive"} className="text-[11px]">
                          {entry.balanced ? "Pass" : "Fail"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" className="h-8" disabled={!result} onClick={onNext}>
          Continue to posting
        </Button>
      </div>
    </div>
  );
}

function Headline({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`text-sm font-semibold ${
          tone === "bad" ? "text-destructive" : tone === "good" ? "text-foreground" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

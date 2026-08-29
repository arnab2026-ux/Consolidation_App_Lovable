import { useQuery } from "@tanstack/react-query";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/reporting";

export interface DrilldownTarget {
  accountCode: string | null;
  accountName?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
}

interface DrilldownRow {
  fact_id: number;
  posting_level: string;
  entity_code: string;
  account_code: string;
  account_name: string;
  movement_code: string | null;
  partner_code: string | null;
  amount_lc: number;
  amount_gc: number;
  source_task: string;
  doc_number: number | null;
  doc_type: string | null;
  description: string | null;
  task_type: string | null;
  task_status: string | null;
  created_at: string;
  created_by_email: string | null;
}

const LEVEL_LABEL: Record<string, string> = {
  "00": "00 reported",
  "01": "01 adjustment",
  "05": "05 translation",
  "10": "10 IC elimination",
  "20": "20 investments",
  "30": "30 group manual",
};

/**
 * The drill-through the pack calls the single most important feature for
 * auditability: from any figure on any report, the rows that produced it,
 * grouped by posting level, each carrying the document and task that wrote it.
 */
export function DrilldownDrawer({
  target,
  onClose,
  versionId,
  fiscalYear,
  period,
  levels,
  consGroupId,
  currency,
}: {
  target: DrilldownTarget | null;
  onClose: () => void;
  versionId: string | null;
  fiscalYear: number;
  period: number;
  levels: readonly string[];
  consGroupId: string | null;
  currency: "LC" | "GC";
}) {
  const rows = useQuery({
    queryKey: [
      "report_drilldown",
      versionId,
      fiscalYear,
      period,
      levels.join(","),
      consGroupId,
      target?.accountCode,
      target?.entityId,
    ],
    enabled: Boolean(target && versionId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_drilldown", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
        p_levels: [...levels],
        ...(consGroupId ? { p_cons_group: consGroupId } : {}),
        ...(target?.accountCode ? { p_account_code: target.accountCode } : {}),
        ...(target?.entityId ? { p_entity_id: target.entityId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as DrilldownRow[];
    },
  });

  const data = rows.data ?? [];
  const grouped = data.reduce<Record<string, DrilldownRow[]>>((acc, row) => {
    (acc[row.posting_level] ??= []).push(row);
    return acc;
  }, {});
  const total = data.reduce((sum, r) => sum + (currency === "LC" ? r.amount_lc : r.amount_gc), 0);

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="text-sm">
            {target?.accountCode} {target?.accountName ? `— ${target.accountName}` : ""}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {target?.entityLabel ? `${target.entityLabel} · ` : ""}
            {fiscalYear}/{period} · {currency} · {data.length} contributing row(s), total{" "}
            {money(total)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
          {data.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {rows.isLoading ? "Loading…" : "No rows contribute to this figure."}
            </p>
          )}

          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([level, levelRows]) => {
              const subtotal = levelRows.reduce(
                (sum, r) => sum + (currency === "LC" ? r.amount_lc : r.amount_gc),
                0,
              );
              return (
                <div key={level} className="rounded border">
                  <div className="flex items-center justify-between border-b px-3 py-1.5">
                    <span className="text-xs font-semibold">
                      {LEVEL_LABEL[level] ?? `Level ${level}`}
                    </span>
                    <span className="text-xs tabular-nums">{money(subtotal)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="h-8">Entity</TableHead>
                        <TableHead className="h-8">Movement</TableHead>
                        <TableHead className="h-8">Partner</TableHead>
                        <TableHead className="h-8 text-right">Amount</TableHead>
                        <TableHead className="h-8">Source</TableHead>
                        <TableHead className="h-8">Document</TableHead>
                        <TableHead className="h-8">By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {levelRows.map((r) => (
                        <TableRow key={r.fact_id} className="text-xs">
                          <TableCell className="font-medium">{r.entity_code}</TableCell>
                          <TableCell>{r.movement_code ?? "—"}</TableCell>
                          <TableCell>{r.partner_code ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(currency === "LC" ? r.amount_lc : r.amount_gc)}
                          </TableCell>
                          <TableCell>
                            {r.source_task}
                            {r.task_status ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {r.task_status.toLowerCase()}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">
                            {r.doc_number ? `#${r.doc_number} ${r.doc_type ?? ""}` : "—"}
                            {r.description ? ` · ${r.description}` : ""}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.created_by_email ?? "system"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { SelectField } from "@/components/field";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { exportCsv } from "@/lib/csv";
import { usePov } from "@/lib/pov-context";

interface MatrixRow {
  entity_id: string;
  entity_code: string;
  partner_id: string;
  partner_code: string;
  rule_code: string;
  elimination_group: string;
  leg1_amount_gc: number;
  leg2_amount_gc: number;
  difference_gc: number;
  status: string;
}

const TITLE = "IC Reconciliation | Consolidation";
const DESCRIPTION =
  "Every intercompany pair in the group, and how far the two sides are apart in group currency.";

const STATUS_STYLE: Record<string, string> = {
  MATCHED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  WITHIN_TOLERANCE: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DIFFERENCE: "bg-destructive/10 text-destructive",
  ONE_SIDED: "bg-muted text-muted-foreground",
};

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const f = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${f})` : f;
}

export const Route = createFileRoute("/_authenticated/reports/ic-reconciliation")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IcReconciliationReport,
});

function IcReconciliationReport() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const [statusFilter, setStatusFilter] = useState("");
  const [ruleFilter, setRuleFilter] = useState("");
  const [drill, setDrill] = useState<{ entity: string; partner: string } | null>(null);

  const matrix = useQuery({
    queryKey: ["ic_matrix", tenantId, versionId, fiscalYear, period, consGroupId],
    enabled: Boolean(tenantId && versionId && consGroupId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ic_matrix", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId as string,
      });
      if (error) throw error;
      return (data ?? []) as MatrixRow[];
    },
  });

  const rows = useMemo(() => matrix.data ?? [], [matrix.data]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!statusFilter || r.status === statusFilter) &&
          (!ruleFilter || r.rule_code === ruleFilter),
      ),
    [rows, statusFilter, ruleFilter],
  );

  const ruleOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.rule_code)))
        .sort()
        .map((c) => ({ value: c, label: c })),
    [rows],
  );

  // Rows = entity, columns = partner, cell = net difference in group currency.
  const { entities, partners, cells } = useMemo(() => {
    const e = Array.from(new Set(filtered.map((r) => r.entity_code))).sort();
    const p = Array.from(new Set(filtered.map((r) => r.partner_code))).sort();
    const map = new Map<string, { difference: number; statuses: Set<string> }>();
    for (const r of filtered) {
      const key = `${r.entity_code}|${r.partner_code}`;
      const cell = map.get(key) ?? { difference: 0, statuses: new Set<string>() };
      cell.difference += r.difference_gc ?? 0;
      cell.statuses.add(r.status);
      map.set(key, cell);
    }
    return { entities: e, partners: p, cells: map };
  }, [filtered]);

  const worstStatus = (statuses: Set<string>) => {
    for (const s of ["DIFFERENCE", "ONE_SIDED", "WITHIN_TOLERANCE", "MATCHED"]) {
      if (statuses.has(s)) return s;
    }
    return "MATCHED";
  };

  const detail = useMemo(
    () =>
      drill
        ? rows.filter((r) => r.entity_code === drill.entity && r.partner_code === drill.partner)
        : [],
    [rows, drill],
  );

  const handleExport = () => {
    exportCsv<MatrixRow>(
      `ic-reconciliation-${fiscalYear}-${period}.csv`,
      [
        { key: "entity_code", label: "Entity" },
        { key: "partner_code", label: "Partner" },
        { key: "rule_code", label: "Rule" },
        { key: "elimination_group", label: "Elimination group" },
        { key: "leg1_amount_gc", label: "Leg 1 (GC)" },
        { key: "leg2_amount_gc", label: "Leg 2 (GC)" },
        { key: "difference_gc", label: "Difference (GC)" },
        { key: "status", label: "Status" },
      ],
      filtered,
    );
  };

  return (
    <PageShell
      title="IC Reconciliation"
      description={DESCRIPTION}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={filtered.length === 0}
          onClick={handleExport}
        >
          <Download className="mr-1 size-3.5" /> Export CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
        <div className="w-48">
          <SelectField
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All statuses"
            options={[
              { value: "", label: "All statuses" },
              { value: "MATCHED", label: "Matched" },
              { value: "WITHIN_TOLERANCE", label: "Within tolerance" },
              { value: "DIFFERENCE", label: "Difference" },
              { value: "ONE_SIDED", label: "One sided" },
            ]}
          />
        </div>
        <div className="w-48">
          <SelectField
            value={ruleFilter}
            onChange={setRuleFilter}
            placeholder="All rules"
            options={[{ value: "", label: "All rules" }, ...ruleOptions]}
          />
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {filtered.length} pair(s) · {fiscalYear}/{period}
        </p>
      </div>

      {!consGroupId && (
        <div className="rounded border border-dashed p-6 text-xs text-muted-foreground">
          Select a consolidation group in the point of view to see the reconciliation matrix.
        </div>
      )}

      {consGroupId && (
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8 sticky left-0 bg-background">Entity \ Partner</TableHead>
                {partners.map((p) => (
                  <TableHead key={p} className="h-8 text-right">
                    {p}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entities.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={partners.length + 1}
                    className="text-xs text-muted-foreground"
                  >
                    {matrix.isLoading
                      ? "Loading…"
                      : "No reconciliation for this point of view — run intercompany reconciliation first."}
                  </TableCell>
                </TableRow>
              )}
              {entities.map((e) => (
                <TableRow key={e} className="text-xs">
                  <TableCell className="sticky left-0 bg-background font-medium">{e}</TableCell>
                  {partners.map((p) => {
                    const cell = cells.get(`${e}|${p}`);
                    if (!cell) {
                      return (
                        <TableCell key={p} className="text-right text-muted-foreground">
                          ·
                        </TableCell>
                      );
                    }
                    const status = worstStatus(cell.statuses);
                    return (
                      <TableCell key={p} className="p-1 text-right">
                        <button
                          type="button"
                          onClick={() => setDrill({ entity: e, partner: p })}
                          className={`w-full rounded px-2 py-1 text-right tabular-nums transition-colors hover:ring-1 hover:ring-ring ${STATUS_STYLE[status] ?? ""}`}
                        >
                          {money(cell.difference)}
                        </button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {Object.entries(STATUS_STYLE).map(([status, cls]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded ${cls}`} />
            {status.replace("_", " ").toLowerCase()}
          </span>
        ))}
      </div>

      <Sheet open={Boolean(drill)} onOpenChange={(open) => !open && setDrill(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {drill?.entity} → {drill?.partner}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Both legs side by side in group currency, per elimination rule.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6 pt-2">
            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="h-8">Rule</TableHead>
                    <TableHead className="h-8">Elimination group</TableHead>
                    <TableHead className="h-8 text-right">Leg 1</TableHead>
                    <TableHead className="h-8 text-right">Leg 2</TableHead>
                    <TableHead className="h-8 text-right">Difference</TableHead>
                    <TableHead className="h-8">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.map((r, i) => (
                    <TableRow key={`${r.rule_code}-${i}`} className="text-xs">
                      <TableCell className="font-medium">{r.rule_code}</TableCell>
                      <TableCell>{r.elimination_group}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.leg1_amount_gc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.leg2_amount_gc)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${r.difference_gc === 0 ? "" : "font-medium"}`}
                      >
                        {money(r.difference_gc)}
                      </TableCell>
                      <TableCell>
                        <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status] ?? ""}`}>
                          {r.status.replace("_", " ").toLowerCase()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {detail.some((r) => r.status === "ONE_SIDED") && (
              <p className="mt-3 rounded border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
                A one-sided position against an equity-method investee is expected: that entity is
                outside the group, so the balance is a genuine external one and is not eliminated.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

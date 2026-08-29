import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

import { SelectField } from "@/components/field";
import { MultiSelect } from "@/components/multi-select";
import { PageShell } from "@/components/page-shell";
import { DrilldownDrawer, type DrilldownTarget } from "@/components/reports/drilldown-drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";
import {
  exportXlsx,
  LEVEL_SETS,
  LEVEL_SET_OPTIONS,
  money,
  percent,
  UNIT_OPTIONS,
  variancePct,
  type LevelSetKey,
} from "@/lib/reporting";

interface StatementRow {
  node_code: string;
  node_name: string;
  parent_code: string | null;
  node_order: number;
  is_leaf: boolean;
  depth: number;
  amount_lc: number;
  amount_gc: number;
  compare_lc: number;
  compare_gc: number;
}

/** Which subtree of the account hierarchy each statement renders. */
const STATEMENTS = [
  { value: "BS", label: "Balance sheet" },
  { value: "PL", label: "Income statement" },
  { value: "EQUITY", label: "Equity" },
  { value: "TOTAL", label: "Everything" },
];

const TITLE = "Consolidated Statements | Consolidation";
const DESCRIPTION = "Balance sheet and income statement rolled up the account hierarchy.";

export const Route = createFileRoute("/_authenticated/reports/consolidated-statements")({
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
  component: StatementsPage,
});

function StatementsPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const master = useMasterCodes(tenantId);
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const [levelSet, setLevelSet] = useState<LevelSetKey>("CONSOLIDATED");
  const [root, setRoot] = useState("BS");
  const [unit, setUnit] = useState("1000");
  const [entities, setEntities] = useState<string[]>([]);
  const [compare, setCompare] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<DrilldownTarget | null>(null);

  const levels = LEVEL_SETS[levelSet];
  const divisor = Number(unit);
  const currency: "LC" | "GC" = levelSet === "CONSOLIDATED" ? "GC" : "LC";

  const rows = useQuery({
    queryKey: [
      "report_statement",
      versionId,
      fiscalYear,
      period,
      levelSet,
      consGroupId,
      entities.join(","),
      compare,
    ],
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_statement", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
        p_hierarchy_code: "AH_STD",
        p_levels: [...levels],
        ...(consGroupId ? { p_cons_group: consGroupId } : {}),
        p_entities: entities,
        ...(compare ? { p_compare_year: fiscalYear - 1, p_compare_period: period } : {}),
      });
      if (error) throw error;
      return (data ?? []) as StatementRow[];
    },
  });

  const all = useMemo(() => rows.data ?? [], [rows.data]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, StatementRow[]>();
    for (const r of all) {
      const key = r.parent_code ?? "__root__";
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    for (const list of map.values()) list.sort((a, b) => a.node_order - b.node_order);
    return map;
  }, [all]);

  // Depth-first walk from the selected root, skipping collapsed subtrees.
  const visible = useMemo(() => {
    const out: { row: StatementRow; indent: number; hasChildren: boolean }[] = [];
    const walk = (code: string, indent: number) => {
      const node = all.find((r) => r.node_code === code);
      if (!node) return;
      const kids = childrenOf.get(code) ?? [];
      out.push({ row: node, indent, hasChildren: kids.length > 0 });
      if (collapsed.has(code)) return;
      for (const k of kids) walk(k.node_code, indent + 1);
    };
    walk(root, 0);
    return out;
  }, [all, childrenOf, collapsed, root]);

  const toggle = (code: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const value = (r: StatementRow) => (currency === "LC" ? r.amount_lc : r.amount_gc);
  const compareValue = (r: StatementRow) => (currency === "LC" ? r.compare_lc : r.compare_gc);

  const handleExport = () => {
    exportXlsx(`statements-${root}-${fiscalYear}-${period}.xlsx`, [
      {
        name: STATEMENTS.find((s) => s.value === root)?.label ?? root,
        columns: [
          { key: "indent", label: "Level" },
          { key: "node_code", label: "Code" },
          { key: "node_name", label: "Line" },
          { key: "current", label: `${fiscalYear}/${period}`, numeric: true },
          ...(compare
            ? [
                { key: "prior", label: `${fiscalYear - 1}/${period}`, numeric: true },
                { key: "variance", label: "Variance", numeric: true },
              ]
            : []),
        ],
        rows: visible.map(({ row, indent }) => ({
          indent,
          node_code: row.node_code,
          node_name: row.node_name,
          current: value(row) / divisor,
          prior: compareValue(row) / divisor,
          variance: (value(row) - compareValue(row)) / divisor,
        })),
      },
    ]);
  };

  return (
    <PageShell
      title="Consolidated Statements"
      description={DESCRIPTION}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={visible.length === 0}
          onClick={handleExport}
        >
          <Download className="mr-1 size-3.5" /> Export XLSX
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
        <div className="w-44">
          <SelectField value={root} onChange={setRoot} options={STATEMENTS} />
        </div>
        <div className="w-52">
          <SelectField
            value={levelSet}
            onChange={(v) => setLevelSet(v as LevelSetKey)}
            options={LEVEL_SET_OPTIONS}
          />
        </div>
        <MultiSelect
          label="Entities"
          options={(master.data?.entities ?? []).map((e) => ({
            value: e.id,
            label: `${e.code} — ${e.name ?? ""}`,
          }))}
          selected={entities}
          onChange={setEntities}
        />
        <div className="w-32">
          <SelectField value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
        </div>
        <label className="flex h-8 items-center gap-2 text-xs">
          <Checkbox checked={compare} onCheckedChange={(v) => setCompare(Boolean(v))} />
          Compare {fiscalYear - 1}
        </label>
        <p className="ml-auto text-xs text-muted-foreground">
          {currency} · {UNIT_OPTIONS.find((u) => u.value === unit)?.label.toLowerCase()}
        </p>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Line</TableHead>
              <TableHead className="h-8 text-right">
                {fiscalYear}/{period}
              </TableHead>
              {compare && (
                <>
                  <TableHead className="h-8 text-right">
                    {fiscalYear - 1}/{period}
                  </TableHead>
                  <TableHead className="h-8 text-right">Variance</TableHead>
                  <TableHead className="h-8 text-right">Variance %</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={compare ? 5 : 2} className="text-xs text-muted-foreground">
                  {rows.isLoading
                    ? "Loading…"
                    : "No hierarchy or no balances — check the account hierarchy and the point of view."}
                </TableCell>
              </TableRow>
            )}
            {visible.map(({ row, indent, hasChildren }) => {
              const current = value(row);
              const prior = compareValue(row);
              const delta = current - prior;
              return (
                <TableRow
                  key={row.node_code}
                  className={`text-xs ${hasChildren ? "font-medium" : ""} ${row.is_leaf ? "cursor-pointer hover:bg-accent" : ""}`}
                  onClick={
                    row.is_leaf
                      ? () =>
                          setDrill({
                            accountCode: row.node_code,
                            accountName: row.node_name,
                            entityId: entities.length === 1 ? (entities[0] ?? null) : null,
                          })
                      : undefined
                  }
                >
                  <TableCell style={{ paddingLeft: `${8 + indent * 16}px` }}>
                    <span className="flex items-center gap-1">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(row.node_code);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {collapsed.has(row.node_code) ? (
                            <ChevronRight className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5" />
                      )}
                      {row.is_leaf ? (
                        <span>
                          <span className="text-muted-foreground">{row.node_code}</span>{" "}
                          {row.node_name}
                        </span>
                      ) : (
                        row.node_name
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(current, divisor)}
                  </TableCell>
                  {compare && (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {money(prior, divisor)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(delta, divisor)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {percent(variancePct(current, prior))}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click any account line to see the rows behind it, grouped by posting level. Subtotals roll
        up the account hierarchy, honouring each node&apos;s aggregation sign.
      </p>

      <DrilldownDrawer
        target={drill}
        onClose={() => setDrill(null)}
        versionId={versionId}
        fiscalYear={fiscalYear}
        period={period}
        levels={levels}
        consGroupId={consGroupId}
        currency={currency}
      />
    </PageShell>
  );
}

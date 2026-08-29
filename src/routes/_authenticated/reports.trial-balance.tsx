import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { SelectField } from "@/components/field";
import { MultiSelect } from "@/components/multi-select";
import { PageShell } from "@/components/page-shell";
import { DrilldownDrawer, type DrilldownTarget } from "@/components/reports/drilldown-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { selectOptionalDimensions, useActiveDimensions } from "@/hooks/use-active-dimensions";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";
import {
  exportXlsx,
  LEVEL_SETS,
  LEVEL_SET_OPTIONS,
  money,
  UNIT_OPTIONS,
  type LevelSetKey,
} from "@/lib/reporting";

interface TbRow {
  entity_id: string;
  entity_code: string;
  entity_name: string | null;
  local_currency: string;
  account_id: string;
  account_code: string;
  account_name: string;
  statement_type: string;
  account_class: string;
  movement_code: string | null;
  movement_name: string | null;
  posting_level: string;
  amount_lc: number;
  amount_gc: number;
}

const TITLE = "Trial Balance | Consolidation";
const DESCRIPTION = "Account-level balances for the point of view, in local and group currency.";

export const Route = createFileRoute("/_authenticated/reports/trial-balance")({
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
  component: TrialBalancePage,
});

function TrialBalancePage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const master = useMasterCodes(tenantId);
  const dims = useActiveDimensions();
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const [levelSet, setLevelSet] = useState<LevelSetKey>("ADJUSTED");
  const [entities, setEntities] = useState<string[]>([]);
  const [unit, setUnit] = useState("1");
  const [search, setSearch] = useState("");
  const [byMovement, setByMovement] = useState("");
  const [drill, setDrill] = useState<DrilldownTarget | null>(null);

  const levels = LEVEL_SETS[levelSet];
  const divisor = Number(unit);
  const currency: "LC" | "GC" = levelSet === "CONSOLIDATED" ? "GC" : "LC";

  const rows = useQuery({
    queryKey: [
      "report_trial_balance",
      versionId,
      fiscalYear,
      period,
      levelSet,
      consGroupId,
      entities.join(","),
    ],
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_trial_balance", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
        p_levels: [...levels],
        ...(consGroupId ? { p_cons_group: consGroupId } : {}),
        p_entities: entities,
      });
      if (error) throw error;
      return (data ?? []) as TbRow[];
    },
  });

  const data = useMemo(() => rows.data ?? [], [rows.data]);

  const filtered = useMemo(
    () =>
      data.filter(
        (r) =>
          (!search ||
            r.account_code.toLowerCase().includes(search.toLowerCase()) ||
            r.account_name.toLowerCase().includes(search.toLowerCase())) &&
          (!byMovement || r.movement_code === byMovement),
      ),
    [data, search, byMovement],
  );

  // One line per account, with the entity breakdown collapsed into it.
  const byAccount = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        statement_type: string;
        account_class: string;
        lc: number;
        gc: number;
        entities: Set<string>;
      }
    >();
    for (const r of filtered) {
      const cur = map.get(r.account_code) ?? {
        code: r.account_code,
        name: r.account_name,
        statement_type: r.statement_type,
        account_class: r.account_class,
        lc: 0,
        gc: 0,
        entities: new Set<string>(),
      };
      cur.lc += r.amount_lc;
      cur.gc += r.amount_gc;
      cur.entities.add(r.entity_code);
      map.set(r.account_code, cur);
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [filtered]);

  const totals = useMemo(
    () =>
      byAccount.reduce(
        (acc, r) => {
          acc.lc += r.lc;
          acc.gc += r.gc;
          if (r.statement_type === "BS" || r.statement_type === "OCI") {
            acc.bsLc += r.lc;
            acc.bsGc += r.gc;
          }
          return acc;
        },
        { lc: 0, gc: 0, bsLc: 0, bsGc: 0 },
      ),
    [byAccount],
  );

  const movements = useMemo(
    () => Array.from(new Set(data.map((r) => r.movement_code).filter(Boolean))).sort(),
    [data],
  );

  const handleExport = () => {
    exportXlsx(`trial-balance-${fiscalYear}-${period}.xlsx`, [
      {
        name: "Trial balance",
        columns: [
          { key: "code", label: "Account" },
          { key: "name", label: "Name" },
          { key: "statement_type", label: "Statement" },
          { key: "account_class", label: "Class" },
          { key: "lc", label: "Local currency", numeric: true },
          { key: "gc", label: "Group currency", numeric: true },
        ],
        rows: byAccount.map((r) => ({ ...r, entities: undefined })),
      },
    ]);
  };

  const activeDimNames = selectOptionalDimensions(dims.data ?? [])
    .map((d) => d.dim_name)
    .join(", ");

  return (
    <PageShell
      title="Trial Balance"
      description={DESCRIPTION}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={byAccount.length === 0}
          onClick={handleExport}
        >
          <Download className="mr-1 size-3.5" /> Export XLSX
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
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
        <div className="w-40">
          <SelectField
            value={byMovement}
            onChange={setByMovement}
            placeholder="All movements"
            options={[
              { value: "", label: "All movements" },
              ...movements.map((m) => ({ value: m as string, label: m as string })),
            ]}
          />
        </div>
        <div className="w-32">
          <SelectField value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
        </div>
        <Input
          className="h-8 w-52 text-xs"
          placeholder="Search account…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="ml-auto text-xs text-muted-foreground">
          {byAccount.length} account(s) · showing {currency}
        </p>
      </div>

      {levelSet === "CONSOLIDATED" && !consGroupId && (
        <p className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Group-currency figures only exist under a consolidation group. Select one in the point of
          view, or the group column stays empty.
        </p>
      )}

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Account</TableHead>
              <TableHead className="h-8">Name</TableHead>
              <TableHead className="h-8">Statement</TableHead>
              <TableHead className="h-8">Class</TableHead>
              <TableHead className="h-8">Entities</TableHead>
              <TableHead className="h-8 text-right">Local currency</TableHead>
              <TableHead className="h-8 text-right">Group currency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byAccount.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-xs text-muted-foreground">
                  {rows.isLoading ? "Loading…" : "No balances for this point of view."}
                </TableCell>
              </TableRow>
            )}
            {byAccount.map((r) => (
              <TableRow
                key={r.code}
                className="cursor-pointer text-xs hover:bg-accent"
                onClick={() =>
                  setDrill({
                    accountCode: r.code,
                    accountName: r.name,
                    entityId: entities.length === 1 ? (entities[0] ?? null) : null,
                  })
                }
              >
                <TableCell className="font-medium">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.statement_type}</TableCell>
                <TableCell className="text-muted-foreground">{r.account_class}</TableCell>
                <TableCell className="text-muted-foreground">{r.entities.size}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.lc, divisor)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.gc, divisor)}</TableCell>
              </TableRow>
            ))}
            {byAccount.length > 0 && (
              <>
                <TableRow className="border-t-2 text-xs font-medium">
                  <TableCell colSpan={5}>Balance sheet subtotal (must be zero)</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${Math.round(totals.bsLc * 100) !== 0 ? "text-destructive" : ""}`}
                  >
                    {money(totals.bsLc, divisor)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${Math.round(totals.bsGc * 100) !== 0 ? "text-destructive" : ""}`}
                  >
                    {money(totals.bsGc, divisor)}
                  </TableCell>
                </TableRow>
                <TableRow className="text-xs font-medium">
                  <TableCell colSpan={5}>Total (all accounts)</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(totals.lc, divisor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(totals.gc, divisor)}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {activeDimNames && (
        <p className="text-[11px] text-muted-foreground">
          Active custom dimensions: {activeDimNames}. Slice by them in the Data Browser; this report
          aggregates across them.
        </p>
      )}

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

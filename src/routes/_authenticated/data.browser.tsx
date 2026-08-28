import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import * as XLSX from "xlsx";

import { MultiSelect } from "@/components/multi-select";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveDimensions } from "@/hooks/use-active-dimensions";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { exportCsv } from "@/lib/csv";
import { usePov } from "@/lib/pov-context";
import { untyped, unwrap } from "@/lib/supabase-untyped";

const TITLE = "Data Browser";
const DESCRIPTION = "Ad-hoc query grid over posted balances with filters, group-by subtotals and drill-through.";

export const Route = createFileRoute("/_authenticated/data/browser")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Consolidation` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `${TITLE} | Consolidation` },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrowserPage,
});

interface FactRow {
  id: number;
  journal_id: string | null;
  task_run_id: string | null;
  source_task: string;
  posting_level: string;
  fiscal_year: number;
  period: number;
  version_code: string;
  entity_code: string;
  account_code: string;
  movement_code: string | null;
  partner_code: string | null;
  cons_group_code: string | null;
  local_currency: string;
  group_currency: string;
  amount_lc: number;
  amount_gc: number;
  [zdim: string]: unknown;
}

const POSTING_LEVELS = ["00", "01", "10", "20", "30"];
type AmountMode = "lc" | "gc" | "both";

function BrowserPage() {
  const { appUser } = useAuth();
  const { pov } = usePov();
  const dimensions = useActiveDimensions();
  const master = useMasterCodes(appUser?.tenant_id);

  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [levels, setLevels] = useState<string[]>([]);
  const [versions, setVersions] = useState<string[]>(pov.versionId ? [pov.versionId] : []);
  const [year, setYear] = useState(String(pov.fiscalYear));
  const [period, setPeriod] = useState(String(pov.period));
  const [amountMode, setAmountMode] = useState<AmountMode>("both");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [drill, setDrill] = useState<FactRow | null>(null);

  const dimColumns = useMemo(() => {
    const generic = (dimensions.data ?? [])
      .filter((dim) => dim.is_active && dim.physical_column.startsWith("zdim"))
      .map((dim) => ({ key: dim.physical_column, label: dim.dim_name, dimCode: dim.dim_code }));
    return [
      { key: "entity_code", label: "Entity", dimCode: "ENTITY" },
      { key: "account_code", label: "Account", dimCode: "ACCOUNT" },
      { key: "movement_code", label: "Movement", dimCode: "MOVEMENT" },
      { key: "partner_code", label: "Partner", dimCode: "PARTNER" },
      { key: "cons_group_code", label: "Cons. group", dimCode: "CONS_GROUP" },
      ...generic,
    ];
  }, [dimensions.data]);

  function optionsFor(key: string, dimCode: string) {
    const codes = master.data;
    if (!codes) return [];
    const list =
      key === "entity_code" || key === "partner_code"
        ? codes.entities
        : key === "account_code"
          ? codes.accounts
          : key === "movement_code"
            ? codes.movements
            : key === "cons_group_code"
              ? codes.consGroups
              : (codes.genericMembers[dimCode] ?? []);
    return list.map((row) => ({ value: row.code, label: `${row.code}${row.name ? ` — ${row.name}` : ""}` }));
  }

  const rows = useQuery({
    queryKey: ["fact-browser", appUser?.tenant_id, filters, levels, versions, year, period],
    enabled: Boolean(appUser),
    queryFn: async () => {
      let query = untyped.from("v_fact_browser").select<FactRow[]>("*");
      if (year.trim()) query = query.eq("fiscal_year", Number(year));
      if (period.trim()) query = query.eq("period", Number(period));
      if (levels.length > 0) query = query.in("posting_level", levels);
      if (versions.length > 0) query = query.in("version_id", versions);
      for (const [key, values] of Object.entries(filters)) {
        if (values.length > 0) query = query.in(key, values);
      }
      return (await unwrap(query.order("id", { ascending: false }).limit(5000))) ?? [];
    },
  });

  const data = rows.data ?? [];

  const grouped = useMemo(() => {
    if (groupBy.length === 0) return null;
    const map = new Map<string, { keys: string[]; lc: number; gc: number; count: number }>();
    for (const row of data) {
      const keys = groupBy.map((key) => String(row[key] ?? "—"));
      const id = keys.join("\u0000");
      const bucket = map.get(id) ?? { keys, lc: 0, gc: 0, count: 0 };
      bucket.lc += Number(row.amount_lc ?? 0);
      bucket.gc += Number(row.amount_gc ?? 0);
      bucket.count += 1;
      map.set(id, bucket);
    }
    return [...map.values()].sort((a, b) => a.keys.join().localeCompare(b.keys.join()));
  }, [data, groupBy]);

  const totalLc = data.reduce((sum, row) => sum + Number(row.amount_lc ?? 0), 0);
  const totalGc = data.reduce((sum, row) => sum + Number(row.amount_gc ?? 0), 0);
  const showLc = amountMode === "lc" || amountMode === "both";
  const showGc = amountMode === "gc" || amountMode === "both";

  const exportRows = useMemo(() => {
    if (grouped) {
      return grouped.map((group) => {
        const record: Record<string, string | number> = {};
        groupBy.forEach((key, index) => {
          record[key] = group.keys[index] ?? "";
        });
        record["rows"] = group.count;
        if (showLc) record["amount_lc"] = round2(group.lc);
        if (showGc) record["amount_gc"] = round2(group.gc);
        return record;
      });
    }
    return data.map((row) => {
      const record: Record<string, string | number> = {
        posting_level: row.posting_level,
        version: row.version_code,
        fiscal_year: row.fiscal_year,
        period: row.period,
      };
      for (const column of dimColumns) record[column.key] = String(row[column.key] ?? "");
      if (showLc) record["amount_lc"] = Number(row.amount_lc ?? 0);
      if (showGc) record["amount_gc"] = Number(row.amount_gc ?? 0);
      return record;
    });
  }, [data, grouped, groupBy, dimColumns, showLc, showGc]);

  function downloadCsvFile() {
    const keys = Object.keys(exportRows[0] ?? {});
    exportCsv(
      "data-browser.csv",
      keys.map((key) => ({ key, label: key })),
      exportRows,
    );
  }

  function downloadXlsx() {
    const sheet = XLSX.utils.json_to_sheet(exportRows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Balances");
    XLSX.writeFile(book, "data-browser.xlsx");
  }

  return (
    <PageShell
      title={TITLE}
      description={DESCRIPTION}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">
            {data.length} row(s)
          </Badge>
          <Button variant="outline" size="sm" className="h-8" disabled={data.length === 0} onClick={downloadCsvFile}>
            <Download className="mr-1 size-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled={data.length === 0} onClick={downloadXlsx}>
            <Download className="mr-1 size-3.5" /> XLSX
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 rounded border p-2">
        {dimColumns.map((column) => (
          <MultiSelect
            key={column.key}
            label={column.label}
            options={optionsFor(column.key, column.dimCode)}
            selected={filters[column.key] ?? []}
            onChange={(values) => setFilters((current) => ({ ...current, [column.key]: values }))}
          />
        ))}
        <MultiSelect
          label="Posting level"
          className="w-36"
          options={POSTING_LEVELS.map((level) => ({ value: level, label: level }))}
          selected={levels}
          onChange={setLevels}
        />
        <MultiSelect
          label="Version"
          className="w-36"
          options={(master.data?.versions ?? []).map((row) => ({ value: row.id, label: row.code }))}
          selected={versions}
          onChange={setVersions}
        />
        <Input
          className="h-8 w-24 text-xs"
          placeholder="Year"
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
        <Input
          className="h-8 w-24 text-xs"
          placeholder="Period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        />
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void rows.refetch()}>
          <Search className="mr-1 size-3.5" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={amountMode} onValueChange={(value) => setAmountMode(value as AmountMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="lc" className="text-xs">
              LC
            </TabsTrigger>
            <TabsTrigger value="gc" className="text-xs">
              GC
            </TabsTrigger>
            <TabsTrigger value="both" className="text-xs">
              Both
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <MultiSelect
          label="Group by"
          className="w-44"
          options={dimColumns.map((column) => ({ value: column.key, label: column.label }))}
          selected={groupBy}
          onChange={setGroupBy}
        />
        {groupBy.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Subtotals by {groupBy.map((key) => dimColumns.find((c) => c.key === key)?.label).join(" › ")}
          </span>
        )}
      </div>

      <div className="overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              {grouped
                ? groupBy.map((key) => (
                    <TableHead key={key} className="h-8 text-xs">
                      {dimColumns.find((column) => column.key === key)?.label ?? key}
                    </TableHead>
                  ))
                : [
                    <TableHead key="level" className="h-8 text-xs">
                      Level
                    </TableHead>,
                    <TableHead key="pov" className="h-8 text-xs">
                      Version / FY / P
                    </TableHead>,
                    ...dimColumns.map((column) => (
                      <TableHead key={column.key} className="h-8 text-xs">
                        {column.label}
                      </TableHead>
                    )),
                  ]}
              {grouped && <TableHead className="h-8 w-16 text-right text-xs">Rows</TableHead>}
              {showLc && <TableHead className="h-8 w-32 text-right text-xs">Amount LC</TableHead>}
              {showGc && <TableHead className="h-8 w-32 text-right text-xs">Amount GC</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.isLoading && (
              <TableRow>
                <TableCell colSpan={20} className="py-2 text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!rows.isLoading && data.length === 0 && (
              <TableRow>
                <TableCell colSpan={20} className="py-2 text-xs text-muted-foreground">
                  No balances match the current filters.
                </TableCell>
              </TableRow>
            )}
            {grouped?.map((group) => (
              <TableRow key={group.keys.join("|")}>
                {group.keys.map((value, index) => (
                  <TableCell key={groupBy[index]} className="py-1 text-xs">
                    {value}
                  </TableCell>
                ))}
                <TableCell className="py-1 text-right text-xs text-muted-foreground">{group.count}</TableCell>
                {showLc && <TableCell className="py-1 text-right font-mono text-xs">{money(group.lc)}</TableCell>}
                {showGc && <TableCell className="py-1 text-right font-mono text-xs">{money(group.gc)}</TableCell>}
              </TableRow>
            ))}
            {!grouped &&
              data.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setDrill(row)}>
                  <TableCell className="py-1 text-xs">{row.posting_level}</TableCell>
                  <TableCell className="py-1 text-xs text-muted-foreground">
                    {row.version_code} · {row.fiscal_year}/{String(row.period).padStart(2, "0")}
                  </TableCell>
                  {dimColumns.map((column) => (
                    <TableCell key={column.key} className="py-1 text-xs">
                      {String(row[column.key] ?? "—")}
                    </TableCell>
                  ))}
                  {showLc && (
                    <TableCell className="py-1 text-right font-mono text-xs">
                      {money(Number(row.amount_lc ?? 0))}
                    </TableCell>
                  )}
                  {showGc && (
                    <TableCell className="py-1 text-right font-mono text-xs">
                      {money(Number(row.amount_gc ?? 0))}
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell
                colSpan={grouped ? groupBy.length + 1 : dimColumns.length + 2}
                className="py-1 text-xs font-medium"
              >
                Total
              </TableCell>
              {showLc && <TableCell className="py-1 text-right font-mono text-xs">{money(totalLc)}</TableCell>}
              {showGc && <TableCell className="py-1 text-right font-mono text-xs">{money(totalGc)}</TableCell>}
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <DrillSheet row={drill} onClose={() => setDrill(null)} />
    </PageShell>
  );
}

interface DrillData {
  journal: {
    doc_number: number;
    doc_type: string;
    posting_level: string;
    description: string | null;
    created_at: string;
    is_reversed: boolean | null;
    created_by_email: string | null;
  } | null;
  task: { task_type: string; status: string | null; started_at: string | null; finished_at: string | null } | null;
}

function DrillSheet({ row, onClose }: { row: FactRow | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["fact-drill", row?.id],
    enabled: Boolean(row),
    queryFn: async (): Promise<DrillData> => {
      const journal = row?.journal_id
        ? await unwrap(
            untyped
              .from("journal_header")
              .select<
                { doc_number: number; doc_type: string; posting_level: string; description: string | null; created_at: string; is_reversed: boolean | null; app_user: { email: string } | null }[]
              >("doc_number, doc_type, posting_level, description, created_at, is_reversed, app_user:created_by(email)")
              .eq("id", row.journal_id)
              .limit(1),
          )
        : null;
      const task = row?.task_run_id
        ? await unwrap(
            untyped
              .from("task_run")
              .select<{ task_type: string; status: string | null; started_at: string | null; finished_at: string | null }[]>(
                "task_type, status, started_at, finished_at",
              )
              .eq("id", row.task_run_id)
              .limit(1),
          )
        : null;
      const head = journal?.[0] ?? null;
      return {
        journal: head
          ? {
              doc_number: head.doc_number,
              doc_type: head.doc_type,
              posting_level: head.posting_level,
              description: head.description,
              created_at: head.created_at,
              is_reversed: head.is_reversed,
              created_by_email: head.app_user?.email ?? null,
            }
          : null,
        task: task?.[0] ?? null,
      };
    },
  });

  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm">Drill-through</SheetTitle>
          <SheetDescription className="text-xs">
            Source document and process run behind this balance row.
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="flex flex-col gap-3 overflow-auto p-4 text-xs">
            <Section title="Balance">
              <Row label="Entity" value={row.entity_code} />
              <Row label="Account" value={row.account_code} />
              <Row label="Movement" value={row.movement_code ?? "—"} />
              <Row label="Partner" value={row.partner_code ?? "—"} />
              <Row label="Cons. group" value={row.cons_group_code ?? "—"} />
              <Row label="Posting level" value={row.posting_level} />
              <Row label="Amount LC" value={`${money(Number(row.amount_lc ?? 0))} ${row.local_currency}`} />
              <Row label="Amount GC" value={`${money(Number(row.amount_gc ?? 0))} ${row.group_currency}`} />
              <Row label="Source task" value={row.source_task} />
            </Section>
            <Section title="Journal header">
              {detail.data?.journal ? (
                <>
                  <Row label="Document" value={String(detail.data.journal.doc_number)} />
                  <Row label="Type" value={detail.data.journal.doc_type} />
                  <Row label="Description" value={detail.data.journal.description ?? "—"} />
                  <Row label="Created" value={new Date(detail.data.journal.created_at).toLocaleString()} />
                  <Row label="Created by" value={detail.data.journal.created_by_email ?? "—"} />
                  <Row label="Reversed" value={detail.data.journal.is_reversed ? "Yes" : "No"} />
                </>
              ) : (
                <p className="text-muted-foreground">No journal linked to this row.</p>
              )}
            </Section>
            <Section title="Task run">
              {detail.data?.task ? (
                <>
                  <Row label="Task type" value={detail.data.task.task_type} />
                  <Row label="Status" value={detail.data.task.status ?? "—"} />
                  <Row
                    label="Started"
                    value={detail.data.task.started_at ? new Date(detail.data.task.started_at).toLocaleString() : "—"}
                  />
                  <Row
                    label="Finished"
                    value={detail.data.task.finished_at ? new Date(detail.data.task.finished_at).toLocaleString() : "—"}
                  />
                </>
              ) : (
                <p className="text-muted-foreground">No task run linked to this row.</p>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border">
      <p className="border-b px-2 py-1 font-medium">{title}</p>
      <div className="flex flex-col gap-1 p-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { SelectField } from "@/components/field";
import { PageShell } from "@/components/page-shell";
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
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { exportCsv } from "@/lib/csv";
import type { Tables } from "@/types/db";

type TaskRun = Tables<"task_run">;

const TITLE = "Task Log | Consolidation";
const DESCRIPTION = "Every task that has run, what it wrote, and how long it took.";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  RUNNING: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  SUCCESS: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  WARNING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ERROR: "bg-destructive/10 text-destructive",
  REVERSED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export const Route = createFileRoute("/_authenticated/process/task-log")({
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
  component: TaskLogPage,
});

interface LogRow extends TaskRun {
  unit: string;
  duration: string;
}

function TaskLogPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const master = useMasterCodes(tenantId);

  const [taskType, setTaskType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const runs = useQuery({
    queryKey: ["task_run", "log", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as TaskRun[];
    },
  });

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of master.data?.entities ?? []) map.set(e.id, e.code);
    for (const g of master.data?.consGroups ?? []) map.set(g.id, g.code);
    return map;
  }, [master.data]);

  const rows: LogRow[] = useMemo(
    () =>
      (runs.data ?? []).map((r) => ({
        ...r,
        unit: r.entity_id
          ? (nameOf.get(r.entity_id) ?? "—")
          : r.cons_group_id
            ? (nameOf.get(r.cons_group_id) ?? "—")
            : "—",
        duration: duration(r.started_at, r.finished_at),
      })),
    [runs.data, nameOf],
  );

  const taskTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.task_type))).sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!taskType || r.task_type === taskType) &&
          (!status || r.status === status) &&
          (!search ||
            r.unit.toLowerCase().includes(search.toLowerCase()) ||
            (r.message ?? "").toLowerCase().includes(search.toLowerCase())),
      ),
    [rows, taskType, status, search],
  );

  const handleExport = () => {
    exportCsv<LogRow>(
      "task-log.csv",
      [
        { key: "started_at", label: "Started" },
        { key: "task_type", label: "Task" },
        { key: "unit", label: "Unit" },
        { key: "fiscal_year", label: "Year" },
        { key: "period", label: "Period" },
        { key: "status", label: "Status" },
        { key: "rows_written", label: "Rows" },
        { key: "duration", label: "Duration" },
        { key: "message", label: "Message" },
      ],
      filtered,
    );
  };

  return (
    <PageShell
      title="Task Log"
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
        <div className="w-44">
          <SelectField
            value={taskType}
            onChange={setTaskType}
            placeholder="All task types"
            options={[
              { value: "", label: "All task types" },
              ...taskTypes.map((t) => ({ value: t, label: t })),
            ]}
          />
        </div>
        <div className="w-40">
          <SelectField
            value={status}
            onChange={setStatus}
            placeholder="All statuses"
            options={[
              { value: "", label: "All statuses" },
              ...Object.keys(STATUS_STYLE).map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        <Input
          className="h-8 w-56 text-xs"
          placeholder="Search unit or message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="ml-auto text-xs text-muted-foreground">{filtered.length} task run(s)</p>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Started</TableHead>
              <TableHead className="h-8">Task</TableHead>
              <TableHead className="h-8">Unit</TableHead>
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8 text-right">Rows</TableHead>
              <TableHead className="h-8 text-right">Duration</TableHead>
              <TableHead className="h-8">Status</TableHead>
              <TableHead className="h-8">Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-xs text-muted-foreground">
                  {runs.isLoading ? "Loading…" : "No task runs match these filters."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="whitespace-nowrap">
                  {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="font-medium">{r.task_type}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell className="tabular-nums">
                  {r.fiscal_year}/{r.period}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.rows_written ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{r.duration}</TableCell>
                <TableCell>
                  <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status ?? ""] ?? ""}`}>
                    {(r.status ?? "—").toLowerCase()}
                  </span>
                </TableCell>
                <TableCell className="max-w-96 truncate text-muted-foreground">
                  {r.message ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}

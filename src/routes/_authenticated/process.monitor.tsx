import { useCallback, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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
import { usePov } from "@/lib/pov-context";
import type { Tables } from "@/types/db";

type WorkflowTemplate = Tables<"workflow_template">;

interface MonitorCell {
  step_id: string;
  step_no: number;
  step_name: string;
  task_type: string;
  scope: string;
  is_blocking: boolean;
  requires_approval: boolean;
  unit_kind: string;
  unit_id: string;
  unit_code: string;
  unit_name: string | null;
  task_run_id: string;
  status: string;
  rows_written: number | null;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  deps_met: boolean;
}

interface ValidationFinding {
  rule_code: string;
  rule_name: string;
  severity: string;
  is_blocking: boolean;
  entity_code: string | null;
  account_code: string | null;
  detail: string;
  amount: number | null;
}

const TITLE = "Consolidation Monitor | Consolidation";
const DESCRIPTION = "Every close step against every consolidation unit, and what still has to run.";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  RUNNING: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  SUCCESS: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  WARNING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ERROR: "bg-destructive/10 text-destructive",
  REVERSED: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "·",
  RUNNING: "…",
  SUCCESS: "OK",
  WARNING: "!",
  ERROR: "✕",
  REVERSED: "↩",
};

export const Route = createFileRoute("/_authenticated/process/monitor")({
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
  component: MonitorPage,
});

function MonitorPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const [templateId, setTemplateId] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MonitorCell | null>(null);
  const [busy, setBusy] = useState(false);

  const templates = useQuery({
    queryKey: ["workflow_template", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_template").select("*").order("code");
      if (error) throw error;
      return (data ?? []) as WorkflowTemplate[];
    },
  });

  const effectiveTemplate = templateId || templates.data?.[0]?.id || "";

  const monitorKey = useMemo(() => ["workflow_monitor", runId] as const, [runId]);

  const monitor = useQuery({
    queryKey: monitorKey,
    enabled: Boolean(runId),
    // Poll while anything is still moving so the grid keeps up with the driver.
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as MonitorCell[];
      return rows.some((r) => r.status === "RUNNING") ? 1500 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase.rpc("workflow_monitor", {
        p_workflow_run_id: runId as string,
      });
      if (error) throw error;
      return (data ?? []) as MonitorCell[];
    },
  });

  const cells = useMemo(() => monitor.data ?? [], [monitor.data]);

  const start = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error("Select a version in the point of view first");
      if (!consGroupId) throw new Error("Select a consolidation group in the point of view first");
      if (!effectiveTemplate) throw new Error("Create or load a workflow template first");
      const { data, error } = await supabase.rpc("start_workflow_run", {
        p_template: effectiveTemplate,
        p_version: versionId,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      setRunId(id);
      void queryClient.invalidateQueries({ queryKey: ["workflow_monitor", id] });
      toast.success("Close opened");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: monitorKey });
  }, [queryClient, monitorKey]);

  const runOne = useMutation({
    mutationFn: async (taskRunId: string) => {
      const { data, error } = await supabase.rpc("run_workflow_task", {
        p_task_run_id: taskRunId,
      });
      if (error) throw error;
      return data as unknown as { status: string; message: string | null };
    },
    onSuccess: (r) => {
      if (r?.status === "ERROR") toast.error(r.message ?? "Task failed");
      else if (r?.status === "WARNING") toast.warning(r.message ?? "Completed with a warning");
      else toast.success("Task completed");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * The dependency-graph driver. Repeatedly runs whatever has become runnable
   * and stops when nothing new does, which is also how a blocked close reports
   * itself: the remaining cells simply never become runnable.
   */
  const runAll = useCallback(
    async (fromStep: number | null) => {
      if (!runId) return;
      setBusy(true);
      let executed = 0;
      let failed = 0;
      try {
        for (let pass = 0; pass < 30; pass++) {
          const { data, error } = await supabase.rpc("workflow_monitor", {
            p_workflow_run_id: runId,
          });
          if (error) throw error;
          const runnable = ((data ?? []) as MonitorCell[])
            .filter(
              (c) =>
                c.status === "PENDING" &&
                c.deps_met &&
                (fromStep === null || c.step_no >= fromStep),
            )
            .sort((a, b) => a.step_no - b.step_no || a.unit_code.localeCompare(b.unit_code));

          if (runnable.length === 0) break;

          for (const cell of runnable) {
            const { data: r, error: e } = await supabase.rpc("run_workflow_task", {
              p_task_run_id: cell.task_run_id,
            });
            if (e) throw e;
            executed += 1;
            if ((r as unknown as { status: string })?.status === "ERROR") failed += 1;
          }
          await refresh();
        }
        if (failed > 0) toast.error(`${executed} task(s) ran, ${failed} failed`);
        else if (executed === 0) toast.info("Nothing is runnable — check upstream steps");
        else toast.success(`${executed} task(s) completed`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Close run failed");
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [runId, refresh],
  );

  // The validation step keeps its findings on task_run.log, so the drawer can
  // say what actually failed instead of just "ERROR".
  const findings = useQuery({
    queryKey: ["task_run_log", detail?.task_run_id],
    enabled: Boolean(detail && detail.task_type === "VALIDATION"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("log")
        .eq("id", detail?.task_run_id as string)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.log;
      return Array.isArray(raw) ? (raw as unknown as ValidationFinding[]) : [];
    },
  });

  const reverse = useMutation({
    mutationFn: async (taskRunId: string) => {
      const { error } = await supabase.rpc("reverse_task_run", { p_task_run_id: taskRunId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task reversed");
      setDetail(null);
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // rows = consolidation units, columns = steps
  const steps = useMemo(() => {
    const map = new Map<number, { step_no: number; name: string; scope: string }>();
    for (const c of cells) {
      if (!map.has(c.step_no)) {
        map.set(c.step_no, { step_no: c.step_no, name: c.step_name, scope: c.scope });
      }
    }
    return [...map.values()].sort((a, b) => a.step_no - b.step_no);
  }, [cells]);

  const units = useMemo(() => {
    const map = new Map<string, { code: string; name: string | null; kind: string }>();
    for (const c of cells) {
      if (!map.has(c.unit_code)) {
        map.set(c.unit_code, { code: c.unit_code, name: c.unit_name, kind: c.unit_kind });
      }
    }
    return [...map.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code),
    );
  }, [cells]);

  const byKey = useMemo(() => {
    const map = new Map<string, MonitorCell>();
    for (const c of cells) map.set(`${c.unit_code}|${c.step_no}`, c);
    return map;
  }, [cells]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cell of cells) c[cell.status] = (c[cell.status] ?? 0) + 1;
    return c;
  }, [cells]);

  return (
    <PageShell
      title="Consolidation Monitor"
      description={DESCRIPTION}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <SelectField
              value={effectiveTemplate}
              onChange={setTemplateId}
              placeholder="Workflow template"
              options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            Open close
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!runId || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className="mr-1 size-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!runId || busy}
            onClick={() => void runAll(null)}
          >
            <Play className="mr-1 size-3.5" /> {busy ? "Running…" : "Run all"}
          </Button>
        </div>
      }
    >
      {!runId && (
        <div className="rounded border border-dashed p-6 text-xs text-muted-foreground">
          Pick a template and choose <strong>Open close</strong> for {fiscalYear}/{period}. The grid
          is built from the consolidation group in the point of view, and a step only becomes
          runnable once the steps it depends on have finished.
        </div>
      )}

      {runId && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded border p-2 text-[11px]">
            {Object.entries(STATUS_STYLE).map(([status, cls]) => (
              <span key={status} className="flex items-center gap-1">
                <span className={`inline-block size-3 rounded ${cls}`} />
                {status.toLowerCase()} {counts[status] ? `(${counts[status]})` : ""}
              </span>
            ))}
            <span className="ml-auto text-muted-foreground">
              Click a cell to run it or read its log.
            </span>
          </div>

          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="sticky left-0 h-8 bg-background">Unit</TableHead>
                  {steps.map((s) => (
                    <TableHead key={s.step_no} className="h-8 whitespace-nowrap text-center">
                      <div className="flex flex-col items-center">
                        <span className="font-medium">{s.step_no}</span>
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {s.name}
                        </span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((u) => (
                  <TableRow key={u.code} className="text-xs">
                    <TableCell className="sticky left-0 whitespace-nowrap bg-background font-medium">
                      {u.code}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {u.kind === "GROUP" ? "group" : ""}
                      </span>
                    </TableCell>
                    {steps.map((s) => {
                      const cell = byKey.get(`${u.code}|${s.step_no}`);
                      if (!cell) {
                        return (
                          <TableCell
                            key={s.step_no}
                            className="text-center text-muted-foreground"
                          ></TableCell>
                        );
                      }
                      return (
                        <TableCell key={s.step_no} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => setDetail(cell)}
                            title={cell.message ?? cell.status}
                            className={`w-full rounded px-2 py-1 transition-colors hover:ring-1 hover:ring-ring ${
                              STATUS_STYLE[cell.status] ?? ""
                            } ${cell.status === "PENDING" && !cell.deps_met ? "opacity-40" : ""}`}
                          >
                            {STATUS_LABEL[cell.status] ?? cell.status}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Run from step:</span>
            {steps.map((s) => (
              <Button
                key={s.step_no}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => void runAll(s.step_no)}
              >
                {s.step_no}
              </Button>
            ))}
          </div>
        </>
      )}

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {detail?.step_no}. {detail?.step_name} — {detail?.unit_code}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {detail?.task_type} · {detail?.scope.toLowerCase()} scope ·{" "}
              {detail?.is_blocking ? "blocking" : "non-blocking"}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="flex flex-col gap-3 px-4 pb-6 pt-2 text-xs">
              <dl className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[detail.status] ?? ""}`}>
                      {detail.status.toLowerCase()}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Rows written</dt>
                  <dd className="tabular-nums">{detail.rows_written ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Dependencies met</dt>
                  <dd>{detail.deps_met ? "yes" : "no — upstream steps still to run"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>
                    {detail.finished_at ? new Date(detail.finished_at).toLocaleString() : "—"}
                  </dd>
                </div>
              </dl>

              {detail.message && (
                <p className="rounded border bg-muted/30 p-2 text-[11px]">{detail.message}</p>
              )}

              {detail.task_type === "VALIDATION" && (findings.data ?? []).length > 0 && (
                <div className="rounded border">
                  <div className="border-b px-2 py-1.5 text-[11px] font-semibold">
                    Validation findings
                  </div>
                  <ul className="divide-y">
                    {(findings.data ?? []).map((f, i) => (
                      <li key={`${f.rule_code}-${i}`} className="px-2 py-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={
                              f.severity === "ERROR"
                                ? "text-destructive"
                                : "text-amber-600 dark:text-amber-400"
                            }
                          >
                            {f.detail}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {f.rule_code}
                          </span>
                        </div>
                        {(f.entity_code || f.account_code) && (
                          <span className="text-[10px] text-muted-foreground">
                            {[f.entity_code, f.account_code].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={reverse.isPending || (detail.rows_written ?? 0) === 0}
                  onClick={() => reverse.mutate(detail.task_run_id)}
                >
                  <RotateCcw className="mr-1 size-3.5" /> Reverse
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={runOne.isPending || !detail.deps_met}
                  onClick={() => runOne.mutate(detail.task_run_id)}
                >
                  <Play className="mr-1 size-3.5" /> Run this step
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

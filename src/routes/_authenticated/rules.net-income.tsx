import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AccountFilterBuilder } from "@/components/rules/account-filter-builder";
import { BoolCell, Field, SelectField } from "@/components/field";
import { MultiSelect } from "@/components/multi-select";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { useMasterCodes } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";
import {
  describeAccountFilter,
  emptyFilter,
  parseAccountFilter,
  serializeAccountFilter,
  type AccountFilter,
} from "@/lib/account-filter";
import type { Json, Tables } from "@/types/db";

type NetIncomeRule = Tables<"rule_net_income">;
type TaskRun = Tables<"task_run">;

interface RunResult {
  task_run_id: string;
  target_kind: string;
  target_id: string;
  target_code: string;
  target_name: string | null;
  net_income_lc: number | null;
  net_income_gc: number | null;
  rows_written: number | null;
  status: string;
  message: string | null;
}

interface BalanceCheck {
  entity_id: string;
  entity_code: string;
  entity_name: string | null;
  currency: string;
  total_assets: number;
  total_liabilities_equity: number;
  difference: number;
  is_balanced: boolean;
}

const TITLE = "Net Income | Consolidation";
const DESCRIPTION = "Transfer of the period result from profit and loss into equity.";

/** Thousands separators, negatives in parentheses, per the project UI rules. */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${formatted})` : formatted;
}

export const Route = createFileRoute("/_authenticated/rules/net-income")({
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
  component: NetIncomePage,
});

function NetIncomePage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const master = useMasterCodes(tenantId);

  const [editing, setEditing] = useState<{ row: NetIncomeRule | null } | null>(null);

  const rules = useQuery({
    queryKey: ["rule_net_income", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_net_income")
        .select("*")
        .order("sequence", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <PageShell
      title="Net Income"
      description={DESCRIPTION}
      actions={
        <Button
          size="sm"
          className="h-8"
          disabled={!tenantId}
          onClick={() => setEditing({ row: null })}
        >
          <Plus className="mr-1 size-3.5" /> New rule
        </Button>
      }
    >
      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Seq</TableHead>
              <TableHead className="h-8">Code</TableHead>
              <TableHead className="h-8">Name</TableHead>
              <TableHead className="h-8">Source filter</TableHead>
              <TableHead className="h-8">Target account</TableHead>
              <TableHead className="h-8">Movement</TableHead>
              <TableHead className="h-8">Active</TableHead>
              <TableHead className="h-8 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-xs text-muted-foreground">
                  Loading rules…
                </TableCell>
              </TableRow>
            )}
            {rules.data?.length === 0 && !rules.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-xs text-muted-foreground">
                  No net income rules yet.
                </TableCell>
              </TableRow>
            )}
            {(rules.data ?? []).map((rule) => (
              <TableRow key={rule.id} className="text-xs">
                <TableCell>{rule.sequence ?? "—"}</TableCell>
                <TableCell className="font-medium">{rule.code}</TableCell>
                <TableCell>{rule.name}</TableCell>
                <TableCell className="max-w-72 truncate text-muted-foreground">
                  {describeAccountFilter(rule.source_account_filter)}
                </TableCell>
                <TableCell>{rule.target_bs_account_code}</TableCell>
                <TableCell>{rule.target_movement_code ?? "—"}</TableCell>
                <TableCell>
                  <BoolCell value={rule.is_active} />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setEditing({ row: rule })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RunPanel
        tenantId={tenantId}
        versionId={pov.versionId}
        fiscalYear={pov.fiscalYear}
        period={pov.period}
        entities={master.data?.entities ?? []}
        groups={master.data?.consGroups ?? []}
      />

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {editing?.row ? "Edit net income rule" : "New net income rule"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              The profit and loss result for the period is posted to a balance sheet equity account,
              so that assets equal liabilities plus equity.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="px-4 pb-6">
              <RuleForm
                row={editing.row}
                tenantId={tenantId}
                movements={(master.data?.movements ?? []).map((m) => ({
                  value: m.code,
                  label: `${m.code} — ${m.name ?? ""}`,
                }))}
                accounts={(master.data?.accounts ?? []).map((a) => ({
                  value: a.code,
                  label: `${a.code} — ${a.name ?? ""}`,
                }))}
                close={() => {
                  setEditing(null);
                  void queryClient.invalidateQueries({ queryKey: ["rule_net_income", tenantId] });
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function RuleForm({
  row,
  tenantId,
  movements,
  accounts,
  close,
}: {
  row: NetIncomeRule | null;
  tenantId: string | null;
  movements: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
  close: () => void;
}) {
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    target_bs_account_code: row?.target_bs_account_code ?? "",
    target_movement_code: row?.target_movement_code ?? "",
    split_to_minority: row?.split_to_minority ?? false,
    minority_account_code: row?.minority_account_code ?? "",
    sequence: row?.sequence?.toString() ?? "",
    is_active: row?.is_active ?? true,
  });
  const [filter, setFilter] = useState<AccountFilter>(
    row ? parseAccountFilter(row.source_account_filter) : emptyFilter(),
  );

  const serialized = useMemo(() => serializeAccountFilter(filter), [filter]);

  const preview = useQuery({
    queryKey: ["resolve_account_filter", tenantId, JSON.stringify(serialized)],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_account_filter", {
        p_tenant: tenantId as string,
        p_filter: serialized as unknown as Json,
      });
      if (error) throw error;
      return data?.length ?? 0;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.target_bs_account_code) {
        throw new Error("Code, name and target balance sheet account are required");
      }
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        source_account_filter: serialized as unknown as Json,
        target_bs_account_code: form.target_bs_account_code,
        target_movement_code: form.target_movement_code || null,
        split_to_minority: form.split_to_minority,
        minority_account_code: form.split_to_minority ? form.minority_account_code || null : null,
        sequence: form.sequence ? Number(form.sequence) : null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("rule_net_income").update(payload).eq("id", row.id)
        : await supabase
            .from("rule_net_income")
            .insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Rule updated" : "Rule created");
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const { error } = await supabase.from("rule_net_income").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rule deleted");
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code">
          <Input
            className="h-8 text-xs"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <Field label="Sequence">
          <Input
            type="number"
            className="h-8 text-xs"
            value={form.sequence}
            onChange={(e) => setForm({ ...form, sequence: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Name">
        <Input
          className="h-8 text-xs"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>

      <Field
        label="Source account filter"
        hint="Only profit and loss accounts are considered, in addition to this filter."
      >
        <AccountFilterBuilder
          value={filter}
          onChange={setFilter}
          matchCount={preview.data ?? null}
        />
      </Field>

      <Field
        label="Target balance sheet account"
        hint="Usually the 'Net income for the period' equity account."
      >
        <SelectField
          value={form.target_bs_account_code}
          onChange={(v) => setForm({ ...form, target_bs_account_code: v })}
          options={accounts}
        />
      </Field>

      <Field
        label="Target movement type"
        hint="Applied only when the target account is movement managed."
      >
        <SelectField
          value={form.target_movement_code}
          onChange={(v) => setForm({ ...form, target_movement_code: v })}
          options={movements}
        />
      </Field>

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.split_to_minority}
          onCheckedChange={(v) => setForm({ ...form, split_to_minority: Boolean(v) })}
        />
        Split the result to non-controlling interests
      </label>
      {form.split_to_minority && (
        <>
          <Field label="Non-controlling interest account">
            <SelectField
              value={form.minority_account_code}
              onChange={(v) => setForm({ ...form, minority_account_code: v })}
              options={accounts}
            />
          </Field>
          <p className="rounded border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
            The non-controlling interest split is posted by Consolidation of Investments, not by
            this task. It is configured here for reference only — the consolidation method,
            ownership percentage and first-consolidation handling all live with that engine, and
            splitting in both places would double count.
          </p>
        </>
      )}
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.is_active}
          onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })}
        />
        Rule is active
      </label>

      <div className="flex justify-between gap-2 pt-3">
        {row ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" className="h-8" disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunPanel({
  tenantId,
  versionId,
  fiscalYear,
  period,
  entities,
  groups,
}: {
  tenantId: string | null;
  versionId: string | null;
  fiscalYear: number;
  period: number;
  entities: { id: string; code: string; name: string | null }[];
  groups: { id: string; code: string; name: string | null }[];
}) {
  const queryClient = useQueryClient();
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, `${e.code} — ${e.name ?? ""}`);
    for (const g of groups) map.set(g.id, `${g.code} — ${g.name ?? ""}`);
    return map;
  }, [entities, groups]);

  const runsKey = ["task_run", "NET_INCOME", tenantId, versionId, fiscalYear, period] as const;
  const checkKey = ["verify_balance_sheet", tenantId, versionId, fiscalYear, period] as const;

  const runs = useQuery({
    queryKey: runsKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .eq("task_type", "NET_INCOME")
        .eq("version_id", versionId as string)
        .eq("fiscal_year", fiscalYear)
        .eq("period", period)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TaskRun[];
    },
  });

  // The verification the whole task exists to satisfy: after the transfer, every
  // entity's assets must equal its liabilities plus equity.
  const check = useQuery({
    queryKey: checkKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_balance_sheet", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
      });
      if (error) throw error;
      return (data ?? []) as BalanceCheck[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error("Select a version in the point of view first");
      if (selectedEntities.length === 0 && selectedGroups.length === 0) {
        throw new Error("Select at least one entity or consolidation group");
      }
      const { data, error } = await supabase.rpc("run_net_income", {
        p_version: versionId,
        p_year: fiscalYear,
        p_period: period,
        p_entities: selectedEntities,
        p_groups: selectedGroups,
      });
      if (error) throw error;
      return (data ?? []) as RunResult[];
    },
    onSuccess: (data) => {
      setResults(data);
      const failed = data.filter((r) => r.status === "ERROR").length;
      const total = data.reduce((sum, r) => sum + (r.rows_written ?? 0), 0);
      if (failed) toast.error(`${failed} target(s) failed — see the results table`);
      else toast.success(`Net income completed: ${total} row(s) written`);
      void queryClient.invalidateQueries({ queryKey: runsKey });
      void queryClient.invalidateQueries({ queryKey: checkKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reverse = useMutation({
    mutationFn: async (taskRunId: string) => {
      const { error } = await supabase.rpc("reverse_task_run", { p_task_run_id: taskRunId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task run reversed");
      setResults([]);
      void queryClient.invalidateQueries({ queryKey: runsKey });
      void queryClient.invalidateQueries({ queryKey: checkKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-sm font-semibold">Run net income</h2>
          <p className="text-xs text-muted-foreground">
            Transfers the {fiscalYear}/{period} profit and loss result into equity for the selected
            targets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            label="Entities"
            options={entities.map((e) => ({ value: e.id, label: `${e.code} — ${e.name ?? ""}` }))}
            selected={selectedEntities}
            onChange={setSelectedEntities}
          />
          <MultiSelect
            label="Groups"
            options={groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name ?? ""}` }))}
            selected={selectedGroups}
            onChange={setSelectedGroups}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={run.isPending || !versionId}
            onClick={() => run.mutate()}
          >
            <Play className="mr-1 size-3.5" /> Run net income
          </Button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8">Target</TableHead>
                <TableHead className="h-8">Kind</TableHead>
                <TableHead className="h-8 text-right">Net income (LC)</TableHead>
                <TableHead className="h-8 text-right">Net income (GC)</TableHead>
                <TableHead className="h-8 text-right">Rows</TableHead>
                <TableHead className="h-8">Status</TableHead>
                <TableHead className="h-8">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.task_run_id} className="text-xs">
                  <TableCell className="font-medium">
                    {result.target_code} — {result.target_name ?? ""}
                  </TableCell>
                  <TableCell>{result.target_kind}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(result.net_income_lc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(result.net_income_gc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {result.rows_written ?? 0}
                  </TableCell>
                  <TableCell>{result.status}</TableCell>
                  <TableCell className="text-muted-foreground">{result.message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-semibold">Balance sheet verification</h3>
          <p className="text-[11px] text-muted-foreground">
            Assets must equal liabilities plus equity once the result has been transferred.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Entity</TableHead>
              <TableHead className="h-8">Currency</TableHead>
              <TableHead className="h-8 text-right">Total assets</TableHead>
              <TableHead className="h-8 text-right">Liabilities + equity</TableHead>
              <TableHead className="h-8 text-right">Difference</TableHead>
              <TableHead className="h-8">Balanced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(check.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  {check.isLoading ? "Checking…" : "No balance sheet data for this point of view."}
                </TableCell>
              </TableRow>
            )}
            {(check.data ?? []).map((entity) => (
              <TableRow key={entity.entity_id} className="text-xs">
                <TableCell className="font-medium">
                  {entity.entity_code} — {entity.entity_name ?? ""}
                </TableCell>
                <TableCell>{entity.currency}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(entity.total_assets)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(entity.total_liabilities_equity)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${entity.is_balanced ? "" : "font-medium text-destructive"}`}
                >
                  {money(entity.difference)}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      entity.is_balanced
                        ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400"
                        : "rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"
                    }
                  >
                    {entity.is_balanced ? "Balanced" : "Out of balance"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Started</TableHead>
              <TableHead className="h-8">Target</TableHead>
              <TableHead className="h-8 text-right">Rows</TableHead>
              <TableHead className="h-8">Status</TableHead>
              <TableHead className="h-8">Message</TableHead>
              <TableHead className="h-8 w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(runs.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  No net income task runs for this point of view.
                </TableCell>
              </TableRow>
            )}
            {(runs.data ?? []).map((taskRun) => {
              const target = taskRun.entity_id ?? taskRun.cons_group_id;
              return (
                <TableRow key={taskRun.id} className="text-xs">
                  <TableCell className="whitespace-nowrap">
                    {taskRun.started_at ? new Date(taskRun.started_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>{target ? (nameOf.get(target) ?? target) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {taskRun.rows_written ?? 0}
                  </TableCell>
                  <TableCell>{taskRun.status ?? "—"}</TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">
                    {taskRun.message ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={
                        reverse.isPending ||
                        taskRun.status === "REVERSED" ||
                        (taskRun.rows_written ?? 0) === 0
                      }
                      onClick={() => reverse.mutate(taskRun.id)}
                    >
                      <RotateCcw className="mr-1 size-3.5" /> Reverse
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

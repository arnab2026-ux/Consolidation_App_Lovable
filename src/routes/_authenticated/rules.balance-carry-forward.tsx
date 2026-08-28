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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { untyped, unwrap } from "@/lib/supabase-untyped";
import { usePov } from "@/lib/pov-context";
import {
  describeAccountFilter,
  emptyFilter,
  parseAccountFilter,
  serializeAccountFilter,
  type AccountFilter,
} from "@/lib/account-filter";
import type { Json, Tables } from "@/types/db";

type BcfRule = Tables<"rule_bcf">;
type TaskRun = Tables<"task_run">;

const MOVEMENT_CLASSES = [
  "OPENING",
  "ADDITION",
  "DISPOSAL",
  "TRANSFER",
  "FX_EFFECT",
  "SCOPE_CHANGE",
  "REVALUATION",
  "CLOSING",
];

const TITLE = "Balance Carry Forward | Consolidation";
const DESCRIPTION = "Rules deriving opening balances of the current year from the prior year closing position.";

export const Route = createFileRoute("/_authenticated/rules/balance-carry-forward")({
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
  component: BcfPage,
});

interface RunResult {
  task_run_id: string;
  target_kind: string;
  target_id: string;
  target_code: string;
  target_name: string | null;
  rows_written: number | null;
  status: string;
  message: string | null;
}

function BcfPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const master = useMasterCodes(tenantId);

  const [editing, setEditing] = useState<{ row: BcfRule | null } | null>(null);

  const rules = useQuery({
    queryKey: ["rule_bcf", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_bcf")
        .select("*")
        .order("sequence", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <PageShell
      title="Balance Carry Forward"
      description={DESCRIPTION}
      actions={
        <Button size="sm" className="h-8" disabled={!tenantId} onClick={() => setEditing({ row: null })}>
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
              <TableHead className="h-8">Account filter</TableHead>
              <TableHead className="h-8">Source classes</TableHead>
              <TableHead className="h-8">Target</TableHead>
              <TableHead className="h-8">P&amp;L → RE</TableHead>
              <TableHead className="h-8">Active</TableHead>
              <TableHead className="h-8 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-xs text-muted-foreground">
                  Loading rules…
                </TableCell>
              </TableRow>
            )}
            {rules.data?.length === 0 && !rules.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-xs text-muted-foreground">
                  No BCF rules yet.
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
                <TableCell>{(rule.source_movement_class ?? []).join(", ") || "All"}</TableCell>
                <TableCell>{rule.target_movement_code}</TableCell>
                <TableCell>
                  {rule.pl_to_retained_earnings ? (rule.retained_earnings_account_code ?? "Yes") : "—"}
                </TableCell>
                <TableCell>
                  <BoolCell value={rule.is_active} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing({ row: rule })}>
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
        entities={master.data?.entities ?? []}
        groups={master.data?.consGroups ?? []}
      />

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="text-sm">{editing?.row ? "Edit BCF rule" : "New BCF rule"}</SheetTitle>
            <SheetDescription className="text-xs">
              Source balances are read from the prior year; results are written to period 0 of the current year.
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
                  void queryClient.invalidateQueries({ queryKey: ["rule_bcf", tenantId] });
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
  row: BcfRule | null;
  tenantId: string | null;
  movements: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
  close: () => void;
}) {
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    target_movement_code: row?.target_movement_code ?? "",
    source_movement_class: row?.source_movement_class ?? [],
    carry_partner: row?.carry_partner ?? true,
    carry_custom_dims: row?.carry_custom_dims ?? true,
    pl_to_retained_earnings: row?.pl_to_retained_earnings ?? false,
    retained_earnings_account_code: row?.retained_earnings_account_code ?? "",
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
      const data = await unwrap(
        untyped.rpc<{ account_id: string }[]>("resolve_account_filter", {
          p_tenant: tenantId,
          p_filter: serialized,
        }),
      );
      return data?.length ?? 0;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.target_movement_code) {
        throw new Error("Code, name and target movement are required");
      }
      if (form.pl_to_retained_earnings && !form.retained_earnings_account_code) {
        throw new Error("Pick a retained earnings account for the P&L transfer");
      }
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        source_account_filter: serialized as unknown as Json,
        source_movement_class: form.source_movement_class.length ? form.source_movement_class : null,
        target_movement_code: form.target_movement_code,
        carry_partner: form.carry_partner,
        carry_custom_dims: form.carry_custom_dims,
        pl_to_retained_earnings: form.pl_to_retained_earnings,
        retained_earnings_account_code: form.pl_to_retained_earnings
          ? form.retained_earnings_account_code
          : null,
        sequence: form.sequence ? Number(form.sequence) : null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("rule_bcf").update(payload).eq("id", row.id)
        : await supabase.from("rule_bcf").insert({ ...payload, tenant_id: tenantId as string });
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
      const { error } = await supabase.from("rule_bcf").delete().eq("id", row.id);
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
          <Input className="h-8 text-xs" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
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
        <Input className="h-8 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>

      <Field label="Source account filter" hint="Balance-sheet and OCI accounts are always required in addition to this filter.">
        <AccountFilterBuilder value={filter} onChange={setFilter} matchCount={preview.data ?? null} />
      </Field>

      <Field label="Source movement classes" hint="Leave empty to carry every movement class.">
        <MultiSelect
          label="Movement classes"
          className="w-full"
          options={MOVEMENT_CLASSES.map((c) => ({ value: c, label: c }))}
          selected={form.source_movement_class}
          onChange={(values) => setForm({ ...form, source_movement_class: values })}
        />
      </Field>

      <Field label="Target movement type">
        <SelectField
          value={form.target_movement_code}
          onChange={(v) => setForm({ ...form, target_movement_code: v })}
          options={movements}
        />
      </Field>

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.carry_partner}
          onCheckedChange={(v) => setForm({ ...form, carry_partner: Boolean(v) })}
        />
        Carry partner breakdown
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.carry_custom_dims}
          onCheckedChange={(v) => setForm({ ...form, carry_custom_dims: Boolean(v) })}
        />
        Carry custom dimensions
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.pl_to_retained_earnings}
          onCheckedChange={(v) => setForm({ ...form, pl_to_retained_earnings: Boolean(v) })}
        />
        Transfer prior-year P&amp;L result to retained earnings
      </label>
      {form.pl_to_retained_earnings && (
        <Field label="Retained earnings account">
          <SelectField
            value={form.retained_earnings_account_code}
            onChange={(v) => setForm({ ...form, retained_earnings_account_code: v })}
            options={accounts}
          />
        </Field>
      )}
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: Boolean(v) })} />
        Rule is active
      </label>

      <div className="flex justify-between gap-2 pt-3">
        {row ? (
          <Button variant="outline" size="sm" className="h-8" disabled={remove.isPending} onClick={() => remove.mutate()}>
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
  entities,
  groups,
}: {
  tenantId: string | null;
  versionId: string | null;
  fiscalYear: number;
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

  const runsKey = ["task_run", "BCF", tenantId, versionId, fiscalYear] as const;

  const runs = useQuery({
    queryKey: runsKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .eq("task_type", "BCF")
        .eq("version_id", versionId as string)
        .eq("fiscal_year", fiscalYear)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TaskRun[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error("Select a version in the point of view first");
      if (selectedEntities.length === 0 && selectedGroups.length === 0) {
        throw new Error("Select at least one entity or consolidation group");
      }
      const data = await unwrap(
        untyped.rpc<RunResult[]>("run_bcf", {
          p_version: versionId,
          p_year: fiscalYear,
          p_entities: selectedEntities,
          p_groups: selectedGroups,
        }),
      );
      return data ?? [];
    },
    onSuccess: (data) => {
      setResults(data);
      const failed = data.filter((r) => r.status === "ERROR").length;
      const total = data.reduce((sum, r) => sum + (r.rows_written ?? 0), 0);
      if (failed) toast.error(`${failed} target(s) failed — see the results table`);
      else toast.success(`BCF completed: ${total} row(s) written`);
      void queryClient.invalidateQueries({ queryKey: runsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reverse = useMutation({
    mutationFn: async (taskRunId: string) => {
      await unwrap(untyped.rpc<{ rows_removed: number }>("reverse_task_run", { p_task_run_id: taskRunId }));
    },
    onSuccess: () => {
      toast.success("Task run reversed");
      setResults([]);
      void queryClient.invalidateQueries({ queryKey: runsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-sm font-semibold">Run BCF</h2>
          <p className="text-xs text-muted-foreground">
            Carries {fiscalYear - 1} closing balances into period 0 of {fiscalYear} for the selected targets.
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
          <Button size="sm" className="h-8" disabled={run.isPending || !versionId} onClick={() => run.mutate()}>
            <Play className="mr-1 size-3.5" /> Run BCF
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
                <TableHead className="h-8 text-right">Rows written</TableHead>
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
                  <TableCell className="text-right tabular-nums">{result.rows_written ?? 0}</TableCell>
                  <TableCell>{result.status}</TableCell>
                  <TableCell className="text-muted-foreground">{result.message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
                  No BCF task runs for this version and year.
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
                  <TableCell className="text-right tabular-nums">{taskRun.rows_written ?? 0}</TableCell>
                  <TableCell>{taskRun.status ?? "—"}</TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">{taskRun.message ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={reverse.isPending || taskRun.status === "REVERSED" || (taskRun.rows_written ?? 0) === 0}
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

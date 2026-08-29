import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Play, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AccountFilterBuilder } from "@/components/rules/account-filter-builder";
import { BoolCell, Field, SelectField } from "@/components/field";
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

type IcRule = Tables<"rule_ic_elim">;
type TaskRun = Tables<"task_run">;

interface RunRow {
  task_run_id: string;
  phase: string;
  pairs: number | null;
  matched: number | null;
  within_tolerance: number | null;
  differences: number | null;
  one_sided: number | null;
  rows_written: number | null;
  eliminated_gc: number | null;
  status: string;
  message: string | null;
}

const POST_CURRENCIES = ["GC", "LC", "BOTH"];

const TITLE = "IC Elimination | Consolidation";
const DESCRIPTION =
  "Rules pairing the two sides of an intercompany position, and the entries that remove them from the group.";

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const f = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${f})` : f;
}

export const Route = createFileRoute("/_authenticated/rules/ic-elimination")({
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
  component: IcEliminationPage,
});

function IcEliminationPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const queryClient = useQueryClient();
  const master = useMasterCodes(tenantId);
  const [editing, setEditing] = useState<{ row: IcRule | null } | null>(null);

  const rules = useQuery({
    queryKey: ["rule_ic_elim", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_ic_elim")
        .select("*")
        .order("sequence", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <PageShell
      title="IC Elimination"
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
      <p className="text-xs text-muted-foreground">
        Both legs are read from translated balances, so currency translation has to run first. How
        much of a pair is eliminated follows the consolidation method, not the ownership percentage:
        fully consolidated entities eliminate in full, proportionate entities at the group&apos;s
        share, and an equity-method counterparty is outside the group so its balance is left alone.
      </p>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Seq</TableHead>
              <TableHead className="h-8">Code</TableHead>
              <TableHead className="h-8">Elimination group</TableHead>
              <TableHead className="h-8">Leg 1</TableHead>
              <TableHead className="h-8">Leg 2</TableHead>
              <TableHead className="h-8 text-right">Tolerance</TableHead>
              <TableHead className="h-8">Difference acct</TableHead>
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
                  No intercompany elimination rules yet.
                </TableCell>
              </TableRow>
            )}
            {(rules.data ?? []).map((rule) => (
              <TableRow key={rule.id} className="text-xs">
                <TableCell>{rule.sequence ?? "—"}</TableCell>
                <TableCell className="font-medium">{rule.code}</TableCell>
                <TableCell>{rule.elimination_group}</TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">
                  {describeAccountFilter(rule.leg1_account_filter)}
                </TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">
                  {describeAccountFilter(rule.leg2_account_filter)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(rule.difference_threshold_abs)} / {rule.difference_threshold_pct ?? 0}%
                </TableCell>
                <TableCell>{rule.real_diff_account_code ?? "—"}</TableCell>
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

      <RunPanel tenantId={tenantId} />

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {editing?.row ? "Edit elimination rule" : "New elimination rule"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Leg 1 and Leg 2 are matched on the entity/partner pair: Leg 1&apos;s entity is Leg
              2&apos;s partner and the other way round.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="px-4 pb-6">
              <RuleForm
                row={editing.row}
                tenantId={tenantId}
                accounts={(master.data?.accounts ?? []).map((a) => ({
                  value: a.code,
                  label: `${a.code} — ${a.name ?? ""}`,
                }))}
                close={() => {
                  setEditing(null);
                  void queryClient.invalidateQueries({ queryKey: ["rule_ic_elim", tenantId] });
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
  accounts,
  close,
}: {
  row: IcRule | null;
  tenantId: string | null;
  accounts: { value: string; label: string }[];
  close: () => void;
}) {
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    elimination_group: row?.elimination_group ?? "",
    is_two_sided: row?.is_two_sided ?? true,
    difference_threshold_abs: row?.difference_threshold_abs?.toString() ?? "0",
    difference_threshold_pct: row?.difference_threshold_pct?.toString() ?? "0",
    currency_diff_account_code: row?.currency_diff_account_code ?? "",
    real_diff_account_code: row?.real_diff_account_code ?? "",
    post_in_currency: row?.post_in_currency ?? "GC",
    sequence: row?.sequence?.toString() ?? "",
    is_active: row?.is_active ?? true,
  });
  const [leg1, setLeg1] = useState<AccountFilter>(
    row ? parseAccountFilter(row.leg1_account_filter) : emptyFilter(),
  );
  const [leg2, setLeg2] = useState<AccountFilter>(
    row ? parseAccountFilter(row.leg2_account_filter) : emptyFilter(),
  );

  const s1 = useMemo(() => serializeAccountFilter(leg1), [leg1]);
  const s2 = useMemo(() => serializeAccountFilter(leg2), [leg2]);

  const c1 = useQuery({
    queryKey: ["resolve_account_filter", tenantId, "leg1", JSON.stringify(s1)],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_account_filter", {
        p_tenant: tenantId as string,
        p_filter: s1 as unknown as Json,
      });
      if (error) throw error;
      return data?.length ?? 0;
    },
  });

  const c2 = useQuery({
    queryKey: ["resolve_account_filter", tenantId, "leg2", JSON.stringify(s2)],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_account_filter", {
        p_tenant: tenantId as string,
        p_filter: s2 as unknown as Json,
      });
      if (error) throw error;
      return data?.length ?? 0;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.elimination_group.trim()) {
        throw new Error("Code, name and elimination group are required");
      }
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        elimination_group: form.elimination_group.trim(),
        leg1_account_filter: s1 as unknown as Json,
        leg2_account_filter: s2 as unknown as Json,
        is_two_sided: form.is_two_sided,
        difference_threshold_abs: Number(form.difference_threshold_abs || 0),
        difference_threshold_pct: Number(form.difference_threshold_pct || 0),
        currency_diff_account_code: form.currency_diff_account_code || null,
        real_diff_account_code: form.real_diff_account_code || null,
        post_in_currency: form.post_in_currency,
        sequence: form.sequence ? Number(form.sequence) : null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("rule_ic_elim").update(payload).eq("id", row.id)
        : await supabase.from("rule_ic_elim").insert({ ...payload, tenant_id: tenantId as string });
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
      const { error } = await supabase.from("rule_ic_elim").delete().eq("id", row.id);
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
        label="Elimination group"
        hint="Matches dim_account.elimination_group; keep one pair of account roles per group."
      >
        <Input
          className="h-8 text-xs"
          value={form.elimination_group}
          onChange={(e) => setForm({ ...form, elimination_group: e.target.value })}
        />
      </Field>

      <Field label="Leg 1 accounts">
        <AccountFilterBuilder value={leg1} onChange={setLeg1} matchCount={c1.data ?? null} />
      </Field>
      <Field label="Leg 2 accounts">
        <AccountFilterBuilder value={leg2} onChange={setLeg2} matchCount={c2.data ?? null} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tolerance (absolute)" hint="Group currency.">
          <Input
            type="number"
            className="h-8 text-xs"
            value={form.difference_threshold_abs}
            onChange={(e) => setForm({ ...form, difference_threshold_abs: e.target.value })}
          />
        </Field>
        <Field label="Tolerance (%)" hint="Of the larger leg.">
          <Input
            type="number"
            step="0.01"
            className="h-8 text-xs"
            value={form.difference_threshold_pct}
            onChange={(e) => setForm({ ...form, difference_threshold_pct: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Real difference account"
        hint="Takes whatever the two legs do not offset. A pair classified DIFFERENCE is not eliminated at all while this is empty, and is reported instead."
      >
        <SelectField
          value={form.real_diff_account_code}
          onChange={(v) => setForm({ ...form, real_diff_account_code: v })}
          options={accounts}
        />
      </Field>
      <Field
        label="Currency difference account"
        hint="Used only when both legs share a transaction currency, so the gap can honestly be attributed to exchange movement."
      >
        <SelectField
          value={form.currency_diff_account_code}
          onChange={(v) => setForm({ ...form, currency_diff_account_code: v })}
          options={accounts}
        />
      </Field>

      <Field label="Post in currency">
        <SelectField
          value={form.post_in_currency}
          onChange={(v) => setForm({ ...form, post_in_currency: v })}
          options={POST_CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      </Field>

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.is_two_sided}
          onCheckedChange={(v) => setForm({ ...form, is_two_sided: Boolean(v) })}
        />
        Two-sided rule
      </label>
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

function RunPanel({ tenantId }: { tenantId: string | null }) {
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<RunRow[]>([]);
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const runsKey = ["task_run", "IC", tenantId, versionId, fiscalYear, period] as const;

  const runs = useQuery({
    queryKey: runsKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .in("task_type", ["IC_RECON", "IC_ELIM"])
        .eq("version_id", versionId as string)
        .eq("fiscal_year", fiscalYear)
        .eq("period", period)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TaskRun[];
    },
  });

  const execute = useMutation({
    mutationFn: async (eliminate: boolean) => {
      if (!versionId) throw new Error("Select a version in the point of view first");
      if (!consGroupId) throw new Error("Select a consolidation group in the point of view first");
      const { data, error } = await supabase.rpc("run_ic", {
        p_version: versionId,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId,
        p_eliminate: eliminate,
      });
      if (error) throw error;
      return (data ?? []) as RunRow[];
    },
    onSuccess: (data) => {
      setResults(data);
      const failed = data.filter((r) => r.status === "ERROR");
      if (failed.length) toast.error(failed[0]?.message ?? "Intercompany processing failed");
      else toast.success("Intercompany processing completed");
      void queryClient.invalidateQueries({ queryKey: runsKey });
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
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="text-sm font-semibold">Run intercompany</h2>
          <p className="text-xs text-muted-foreground">
            Reconciliation compares the two legs and posts nothing. Elimination then removes them
            from the group at posting level 10.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={execute.isPending || !versionId || !consGroupId}
            onClick={() => execute.mutate(false)}
          >
            <FlaskConical className="mr-1 size-3.5" /> Test (reconcile only)
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={execute.isPending || !versionId || !consGroupId}
            onClick={() => execute.mutate(true)}
          >
            <Play className="mr-1 size-3.5" /> Reconcile and eliminate
          </Button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8">Phase</TableHead>
                <TableHead className="h-8 text-right">Pairs</TableHead>
                <TableHead className="h-8 text-right">Matched</TableHead>
                <TableHead className="h-8 text-right">In tolerance</TableHead>
                <TableHead className="h-8 text-right">Differences</TableHead>
                <TableHead className="h-8 text-right">One sided</TableHead>
                <TableHead className="h-8 text-right">Rows</TableHead>
                <TableHead className="h-8 text-right">Eliminated (GC)</TableHead>
                <TableHead className="h-8">Status</TableHead>
                <TableHead className="h-8">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.task_run_id} className="text-xs">
                  <TableCell className="font-medium">{r.phase}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pairs ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.matched ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.within_tolerance ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.differences ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.one_sided ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows_written ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.eliminated_gc)}
                  </TableCell>
                  <TableCell className={r.status === "ERROR" ? "font-medium text-destructive" : ""}>
                    {r.status}
                  </TableCell>
                  <TableCell className="max-w-80 text-muted-foreground">
                    {r.message ?? "—"}
                  </TableCell>
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
              <TableHead className="h-8">Task</TableHead>
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
                  No intercompany task runs for this point of view.
                </TableCell>
              </TableRow>
            )}
            {(runs.data ?? []).map((taskRun) => (
              <TableRow key={taskRun.id} className="text-xs">
                <TableCell className="whitespace-nowrap">
                  {taskRun.started_at ? new Date(taskRun.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>{taskRun.task_type}</TableCell>
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
                      taskRun.task_type !== "IC_ELIM" ||
                      (taskRun.rows_written ?? 0) === 0
                    }
                    onClick={() => reverse.mutate(taskRun.id)}
                  >
                    <RotateCcw className="mr-1 size-3.5" /> Reverse
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

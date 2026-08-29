import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Play, Plus, RotateCcw } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes, type CodeRow } from "@/hooks/use-master-codes";
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

type TranslationRule = Tables<"rule_translation">;
type HistoricalRate = Tables<"historical_rate">;
type TaskRun = Tables<"task_run">;

interface RunResult {
  task_run_id: string;
  entity_id: string;
  entity_code: string;
  entity_name: string | null;
  local_currency: string;
  group_currency: string;
  closing_rate: number | null;
  average_rate: number | null;
  total_lc: number | null;
  total_gc: number | null;
  cta_gc: number | null;
  rows_written: number | null;
  status: string;
  message: string | null;
}

interface CoverageRow {
  entity_code: string;
  from_currency: string;
  to_currency: string;
  rate_type: string;
  rate: number | null;
  is_present: boolean;
}

const RATE_TYPES = ["CLOSING", "AVERAGE", "HISTORICAL", "OPENING"];
const DIFFERENCE_SCOPES = ["BS", "PL", "EQUITY"];

const TITLE = "Currency Translation | Consolidation";
const DESCRIPTION =
  "Re-expression of reported balances in the group currency, and the resulting translation adjustment.";

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${formatted})` : formatted;
}

function rate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export const Route = createFileRoute("/_authenticated/rules/currency-translation")({
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
  component: TranslationPage,
});

function TranslationPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const master = useMasterCodes(tenantId);

  return (
    <PageShell title="Currency Translation" description={DESCRIPTION}>
      <Tabs defaultValue="rules">
        <TabsList className="h-8">
          <TabsTrigger value="rules" className="text-xs">
            Rules
          </TabsTrigger>
          <TabsTrigger value="historical" className="text-xs">
            Historical rates
          </TabsTrigger>
          <TabsTrigger value="run" className="text-xs">
            Run
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-3">
          <RulesTab tenantId={tenantId} accounts={master.data?.accounts ?? []} />
        </TabsContent>
        <TabsContent value="historical" className="mt-3">
          <HistoricalRatesTab
            tenantId={tenantId}
            entities={master.data?.entities ?? []}
            accounts={master.data?.accounts ?? []}
            movements={master.data?.movements ?? []}
          />
        </TabsContent>
        <TabsContent value="run" className="mt-3">
          <RunTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesTab({ tenantId, accounts }: { tenantId: string | null; accounts: CodeRow[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ row: TranslationRule | null } | null>(null);

  const rules = useQuery({
    queryKey: ["rule_translation", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_translation")
        .select("*")
        .order("sequence", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Rules are evaluated in sequence and the first match wins, so an account caught by two
          rules is translated once. An account no rule claims is reported after the run rather than
          being folded silently into the translation adjustment.
        </p>
        <Button
          size="sm"
          className="h-8"
          disabled={!tenantId}
          onClick={() => setEditing({ row: null })}
        >
          <Plus className="mr-1 size-3.5" /> New rule
        </Button>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Seq</TableHead>
              <TableHead className="h-8">Code</TableHead>
              <TableHead className="h-8">Name</TableHead>
              <TableHead className="h-8">Account filter</TableHead>
              <TableHead className="h-8">Rate type</TableHead>
              <TableHead className="h-8">CTA account</TableHead>
              <TableHead className="h-8">Scope</TableHead>
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
                  No translation rules yet.
                </TableCell>
              </TableRow>
            )}
            {(rules.data ?? []).map((rule) => (
              <TableRow key={rule.id} className="text-xs">
                <TableCell>{rule.sequence ?? "—"}</TableCell>
                <TableCell className="font-medium">{rule.code}</TableCell>
                <TableCell>{rule.name}</TableCell>
                <TableCell className="max-w-72 truncate text-muted-foreground">
                  {describeAccountFilter(rule.account_filter)}
                </TableCell>
                <TableCell>{rule.rate_type}</TableCell>
                <TableCell>{rule.post_difference_to ?? "—"}</TableCell>
                <TableCell>{rule.difference_scope ?? "—"}</TableCell>
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

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {editing?.row ? "Edit translation rule" : "New translation rule"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Assets and liabilities normally move to the closing rate while equity stays at its
              historical rate. The gap that leaves in the balance sheet is the translation
              adjustment.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="px-4 pb-6">
              <RuleForm
                row={editing.row}
                tenantId={tenantId}
                accounts={accounts.map((a) => ({
                  value: a.code,
                  label: `${a.code} — ${a.name ?? ""}`,
                }))}
                close={() => {
                  setEditing(null);
                  void queryClient.invalidateQueries({ queryKey: ["rule_translation", tenantId] });
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RuleForm({
  row,
  tenantId,
  accounts,
  close,
}: {
  row: TranslationRule | null;
  tenantId: string | null;
  accounts: { value: string; label: string }[];
  close: () => void;
}) {
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    rate_type: row?.rate_type ?? "CLOSING",
    historical_rate_source: row?.historical_rate_source ?? "ACQUISITION",
    post_difference_to: row?.post_difference_to ?? "",
    difference_scope: row?.difference_scope ?? "BS",
    sequence: row?.sequence?.toString() ?? "",
    is_active: row?.is_active ?? true,
  });
  const [filter, setFilter] = useState<AccountFilter>(
    row ? parseAccountFilter(row.account_filter) : emptyFilter(),
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
      if (!form.code.trim() || !form.name.trim()) throw new Error("Code and name are required");
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        account_filter: serialized as unknown as Json,
        rate_type: form.rate_type,
        historical_rate_source: form.historical_rate_source || null,
        post_difference_to: form.post_difference_to || null,
        difference_scope: form.difference_scope || null,
        sequence: form.sequence ? Number(form.sequence) : null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("rule_translation").update(payload).eq("id", row.id)
        : await supabase
            .from("rule_translation")
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
      const { error } = await supabase.from("rule_translation").delete().eq("id", row.id);
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
        <Field label="Sequence" hint="Lower runs first; the first matching rule owns the account.">
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

      <Field label="Account filter">
        <AccountFilterBuilder
          value={filter}
          onChange={setFilter}
          matchCount={preview.data ?? null}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate type">
          <SelectField
            value={form.rate_type}
            onChange={(v) => setForm({ ...form, rate_type: v })}
            options={RATE_TYPES.map((r) => ({ value: r, label: r }))}
          />
        </Field>
        <Field label="Difference scope">
          <SelectField
            value={form.difference_scope}
            onChange={(v) => setForm({ ...form, difference_scope: v })}
            options={DIFFERENCE_SCOPES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
      </div>

      {form.rate_type === "HISTORICAL" && (
        <Field
          label="Historical rate source"
          hint="A rate pinned on the Historical rates tab wins. Otherwise the closing rate of the acquisition year is used, falling back to the current closing rate."
        >
          <Input
            className="h-8 text-xs"
            value={form.historical_rate_source}
            onChange={(e) => setForm({ ...form, historical_rate_source: e.target.value })}
          />
        </Field>
      )}

      <Field
        label="Post difference to (CTA account)"
        hint="The balancing figure that makes the translated balance sheet foot again."
      >
        <SelectField
          value={form.post_difference_to}
          onChange={(v) => setForm({ ...form, post_difference_to: v })}
          options={accounts}
        />
      </Field>

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

/* ------------------------------------------------------- historical rates */

function HistoricalRatesTab({
  tenantId,
  entities,
  accounts,
  movements,
}: {
  tenantId: string | null;
  entities: CodeRow[];
  accounts: CodeRow[];
  movements: CodeRow[];
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    entity_id: "",
    account_id: "",
    movement_id: "",
    rate: "",
    valid_from_year: "",
  });

  const key = ["historical_rate", tenantId] as const;

  const rows = useQuery({
    queryKey: key,
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("historical_rate").select("*").limit(500);
      if (error) throw error;
      return (data ?? []) as HistoricalRate[];
    },
  });

  const label = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, e.code);
    for (const a of accounts) map.set(a.id, `${a.code} — ${a.name ?? ""}`);
    for (const m of movements) map.set(m.id, m.code);
    return map;
  }, [entities, accounts, movements]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.entity_id || !form.account_id || !form.rate) {
        throw new Error("Entity, account and rate are required");
      }
      const { error } = await supabase.from("historical_rate").insert({
        tenant_id: tenantId as string,
        entity_id: form.entity_id,
        account_id: form.account_id,
        movement_id: form.movement_id || null,
        rate: Number(form.rate),
        valid_from_year: form.valid_from_year ? Number(form.valid_from_year) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Historical rate added");
      setAdding(false);
      setForm({ entity_id: "", account_id: "", movement_id: "", rate: "", valid_from_year: "" });
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("historical_rate").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Historical rate removed");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Rates pinned per entity and account, used by rules with rate type HISTORICAL. Equity held
          at its acquisition rate against net assets at the closing rate is what creates the
          translation adjustment.
        </p>
        <Button size="sm" className="h-8" disabled={!tenantId} onClick={() => setAdding(true)}>
          <Plus className="mr-1 size-3.5" /> Add rate
        </Button>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Entity</TableHead>
              <TableHead className="h-8">Account</TableHead>
              <TableHead className="h-8">Movement</TableHead>
              <TableHead className="h-8 text-right">Rate</TableHead>
              <TableHead className="h-8 text-right">Valid from</TableHead>
              <TableHead className="h-8 w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  {rows.isLoading ? "Loading…" : "No historical rates pinned."}
                </TableCell>
              </TableRow>
            )}
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.id} className="text-xs">
                <TableCell>{label.get(row.entity_id) ?? row.entity_id}</TableCell>
                <TableCell>{label.get(row.account_id) ?? row.account_id}</TableCell>
                <TableCell>
                  {row.movement_id ? (label.get(row.movement_id) ?? "—") : "All"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{rate(row.rate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.valid_from_year ?? "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(row.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-sm">Pin a historical rate</SheetTitle>
            <SheetDescription className="text-xs">
              Applies to rules with rate type HISTORICAL. Leave the movement empty to cover every
              movement type on the account.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
            <Field label="Entity">
              <SelectField
                value={form.entity_id}
                onChange={(v) => setForm({ ...form, entity_id: v })}
                options={entities.map((e) => ({
                  value: e.id,
                  label: `${e.code} — ${e.name ?? ""}`,
                }))}
              />
            </Field>
            <Field label="Account">
              <SelectField
                value={form.account_id}
                onChange={(v) => setForm({ ...form, account_id: v })}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.code} — ${a.name ?? ""}`,
                }))}
              />
            </Field>
            <Field label="Movement type (optional)">
              <SelectField
                value={form.movement_id}
                onChange={(v) => setForm({ ...form, movement_id: v })}
                options={movements.map((m) => ({
                  value: m.id,
                  label: `${m.code} — ${m.name ?? ""}`,
                }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate">
                <Input
                  type="number"
                  step="0.00000001"
                  className="h-8 text-xs"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                />
              </Field>
              <Field label="Valid from year">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.valid_from_year}
                  onChange={(e) => setForm({ ...form, valid_from_year: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* -------------------------------------------------------------------- run */

function RunTab({ tenantId }: { tenantId: string | null }) {
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const master = useMasterCodes(tenantId);
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);

  const { versionId, fiscalYear, period, consGroupId } = pov;
  const entities = useMemo(() => master.data?.entities ?? [], [master.data]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, `${e.code} — ${e.name ?? ""}`);
    return map;
  }, [entities]);

  const runsKey = ["task_run", "TRANSLATION", tenantId, versionId, fiscalYear, period] as const;
  const coverageKey = [
    "check_fx_coverage",
    tenantId,
    versionId,
    fiscalYear,
    period,
    consGroupId,
  ] as const;

  // The run is blocked while any required rate is missing: a half-translated
  // group is worse than an untranslated one, because it still adds up.
  const coverage = useQuery({
    queryKey: coverageKey,
    enabled: Boolean(tenantId && versionId && consGroupId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("check_fx_coverage", {
        p_version: versionId as string,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId as string,
      });
      if (error) throw error;
      return (data ?? []) as CoverageRow[];
    },
  });

  const missing = (coverage.data ?? []).filter((r) => !r.is_present);

  const runs = useQuery({
    queryKey: runsKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .eq("task_type", "TRANSLATION")
        .eq("version_id", versionId as string)
        .eq("fiscal_year", fiscalYear)
        .eq("period", period)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TaskRun[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error("Select a version in the point of view first");
      if (!consGroupId)
        throw new Error("Translation is group dependent: select a consolidation group");
      if (missing.length > 0)
        throw new Error(`${missing.length} exchange rate(s) missing — resolve them first`);
      const { data, error } = await supabase.rpc("run_currency_translation", {
        p_version: versionId,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId,
        p_entities: selectedEntities,
      });
      if (error) throw error;
      return (data ?? []) as RunResult[];
    },
    onSuccess: (data) => {
      setResults(data);
      const failed = data.filter((r) => r.status === "ERROR").length;
      const warned = data.filter((r) => r.status === "WARNING" || r.message).length;
      if (failed) toast.error(`${failed} entity/entities failed — see the results table`);
      else if (warned) toast.warning("Translation completed with warnings — see the results table");
      else toast.success(`Translation completed for ${data.length} entity/entities`);
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded border p-3">
        <div>
          <h2 className="text-sm font-semibold">Run translation</h2>
          <p className="text-xs text-muted-foreground">
            Re-expresses {fiscalYear}/{period} reported balances in the group currency. Leave the
            entity selection empty to translate every member of the consolidation group.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            label="Entities"
            options={entities.map((e) => ({ value: e.id, label: `${e.code} — ${e.name ?? ""}` }))}
            selected={selectedEntities}
            onChange={setSelectedEntities}
          />
          <Button
            size="sm"
            className="h-8"
            disabled={run.isPending || !versionId || !consGroupId || missing.length > 0}
            onClick={() => run.mutate()}
          >
            <Play className="mr-1 size-3.5" /> Run translation
          </Button>
        </div>
      </div>

      <div className="rounded border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-semibold">Rate coverage</h3>
          {missing.length > 0 ? (
            <span className="flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="size-3.5" />
              {missing.length} rate(s) missing — the run is blocked
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {coverage.isLoading ? "Checking…" : "Every required rate is on file."}
            </span>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Entity</TableHead>
              <TableHead className="h-8">Pair</TableHead>
              <TableHead className="h-8">Rate type</TableHead>
              <TableHead className="h-8 text-right">Rate</TableHead>
              <TableHead className="h-8">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(coverage.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-xs text-muted-foreground">
                  {consGroupId
                    ? "No foreign-currency entities in this consolidation group."
                    : "Select a consolidation group in the point of view."}
                </TableCell>
              </TableRow>
            )}
            {(coverage.data ?? []).map((row, i) => (
              <TableRow key={`${row.entity_code}-${row.rate_type}-${i}`} className="text-xs">
                <TableCell className="font-medium">{row.entity_code}</TableCell>
                <TableCell>
                  {row.from_currency} → {row.to_currency}
                </TableCell>
                <TableCell>{row.rate_type}</TableCell>
                <TableCell className="text-right tabular-nums">{rate(row.rate)}</TableCell>
                <TableCell>
                  <span
                    className={
                      row.is_present
                        ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400"
                        : "rounded bg-destructive/10 px-1.5 py-0.5 text-destructive"
                    }
                  >
                    {row.is_present ? "On file" : "Missing"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {results.length > 0 && (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8">Entity</TableHead>
                <TableHead className="h-8">LC</TableHead>
                <TableHead className="h-8 text-right">Closing</TableHead>
                <TableHead className="h-8 text-right">Average</TableHead>
                <TableHead className="h-8 text-right">Local total</TableHead>
                <TableHead className="h-8 text-right">Group total</TableHead>
                <TableHead className="h-8 text-right">CTA posted</TableHead>
                <TableHead className="h-8">Status</TableHead>
                <TableHead className="h-8">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.task_run_id} className="text-xs">
                  <TableCell className="font-medium">
                    {r.entity_code} — {r.entity_name ?? ""}
                  </TableCell>
                  <TableCell>{r.local_currency}</TableCell>
                  <TableCell className="text-right tabular-nums">{rate(r.closing_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rate(r.average_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total_lc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total_gc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.cta_gc)}</TableCell>
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
              <TableHead className="h-8">Entity</TableHead>
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
                  No translation task runs for this point of view.
                </TableCell>
              </TableRow>
            )}
            {(runs.data ?? []).map((taskRun) => (
              <TableRow key={taskRun.id} className="text-xs">
                <TableCell className="whitespace-nowrap">
                  {taskRun.started_at ? new Date(taskRun.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  {taskRun.entity_id ? (nameOf.get(taskRun.entity_id) ?? taskRun.entity_id) : "—"}
                </TableCell>
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
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

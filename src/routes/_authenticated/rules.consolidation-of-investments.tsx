import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes, type CodeRow } from "@/hooks/use-master-codes";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";
import type { Tables } from "@/types/db";

type CoiRule = Tables<"rule_coi">;
type Investment = Tables<"investment_register">;
type TaskRun = Tables<"task_run">;

interface RunResult {
  task_run_id: string;
  investee_id: string;
  investee_code: string;
  investee_name: string | null;
  cons_method: string;
  group_share_pct: number | null;
  net_assets_gc: number | null;
  investment_gc: number | null;
  goodwill_gc: number | null;
  nci_equity_gc: number | null;
  nci_pl_gc: number | null;
  equity_pickup_gc: number | null;
  residual_gc: number | null;
  rows_written: number | null;
  status: string;
  message: string | null;
}

const METHODS = ["PURCHASE", "PROPORTIONATE", "EQUITY"];
const ACTIVITIES = [
  "FIRST_CONSOLIDATION",
  "SUBSEQUENT",
  "STEP_ACQUISITION",
  "PARTIAL_DISPOSAL",
  "TOTAL_DISPOSAL",
  "METHOD_CHANGE",
  "CAPITAL_INCREASE",
  "DISTRIBUTION",
];
const NCI_MEASUREMENTS = ["PROPORTIONATE", "FULL_GOODWILL"];

const TITLE = "Consolidation of Investments | Consolidation";
const DESCRIPTION =
  "Elimination of an investment against the investee's equity, and the goodwill and non-controlling interests that fall out of it.";

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const f = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${f})` : f;
}

export const Route = createFileRoute("/_authenticated/rules/consolidation-of-investments")({
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
  component: CoiPage,
});

function CoiPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const master = useMasterCodes(tenantId);

  return (
    <PageShell title="Consolidation of Investments" description={DESCRIPTION}>
      <Tabs defaultValue="rules">
        <TabsList className="h-8">
          <TabsTrigger value="rules" className="text-xs">
            Rules
          </TabsTrigger>
          <TabsTrigger value="register" className="text-xs">
            Investment register
          </TabsTrigger>
          <TabsTrigger value="run" className="text-xs">
            Run
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-3">
          <RulesTab tenantId={tenantId} accounts={master.data?.accounts ?? []} />
        </TabsContent>
        <TabsContent value="register" className="mt-3">
          <RegisterTab
            tenantId={tenantId}
            entities={master.data?.entities ?? []}
            groups={master.data?.consGroups ?? []}
          />
        </TabsContent>
        <TabsContent value="run" className="mt-3">
          <RunTab tenantId={tenantId} entities={master.data?.entities ?? []} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesTab({ tenantId, accounts }: { tenantId: string | null; accounts: CodeRow[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ row: CoiRule | null } | null>(null);

  const rules = useQuery({
    queryKey: ["rule_coi", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rule_coi")
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
          One rule per consolidation method. The method itself comes from the entity&apos;s
          membership of the consolidation group, not from the rule.
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
              <TableHead className="h-8">Code</TableHead>
              <TableHead className="h-8">Method</TableHead>
              <TableHead className="h-8">Investment</TableHead>
              <TableHead className="h-8">Goodwill</TableHead>
              <TableHead className="h-8">Badwill</TableHead>
              <TableHead className="h-8">NCI equity</TableHead>
              <TableHead className="h-8">Equity pickup</TableHead>
              <TableHead className="h-8">Active</TableHead>
              <TableHead className="h-8 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.data?.length === 0 && !rules.isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-xs text-muted-foreground">
                  No consolidation-of-investments rules yet.
                </TableCell>
              </TableRow>
            )}
            {(rules.data ?? []).map((rule) => (
              <TableRow key={rule.id} className="text-xs">
                <TableCell className="font-medium">{rule.code}</TableCell>
                <TableCell>{rule.cons_method}</TableCell>
                <TableCell>{rule.investment_account_code}</TableCell>
                <TableCell>{rule.goodwill_account_code ?? "—"}</TableCell>
                <TableCell>{rule.badwill_account_code ?? "—"}</TableCell>
                <TableCell>{rule.nci_equity_account_code ?? "—"}</TableCell>
                <TableCell>{rule.equity_pickup_account_code ?? "—"}</TableCell>
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
            <SheetTitle className="text-sm">{editing?.row ? "Edit rule" : "New rule"}</SheetTitle>
            <SheetDescription className="text-xs">
              Accounts the engine posts to. Which of them are used depends on the method.
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
                  void queryClient.invalidateQueries({ queryKey: ["rule_coi", tenantId] });
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
  row: CoiRule | null;
  tenantId: string | null;
  accounts: { value: string; label: string }[];
  close: () => void;
}) {
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    cons_method: row?.cons_method ?? "PURCHASE",
    investment_account_code: row?.investment_account_code ?? "",
    goodwill_account_code: row?.goodwill_account_code ?? "",
    badwill_account_code: row?.badwill_account_code ?? "",
    nci_equity_account_code: row?.nci_equity_account_code ?? "",
    nci_pl_account_code: row?.nci_pl_account_code ?? "",
    equity_pickup_account_code: row?.equity_pickup_account_code ?? "",
    equity_income_account_code: row?.equity_income_account_code ?? "",
    goodwill_amortisation_account_code: row?.goodwill_amortisation_account_code ?? "",
    sequence: row?.sequence?.toString() ?? "",
    is_active: row?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.investment_account_code) {
        throw new Error("Code, name and investment account are required");
      }
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        cons_method: form.cons_method,
        investment_account_code: form.investment_account_code,
        equity_account_filter: (row?.equity_account_filter ?? {
          op: "AND",
          conditions: [{ field: "is_equity_account", operator: "is_true" }],
        }) as never,
        goodwill_account_code: form.goodwill_account_code || null,
        badwill_account_code: form.badwill_account_code || null,
        nci_equity_account_code: form.nci_equity_account_code || null,
        nci_pl_account_code: form.nci_pl_account_code || null,
        equity_pickup_account_code: form.equity_pickup_account_code || null,
        equity_income_account_code: form.equity_income_account_code || null,
        goodwill_amortisation_account_code: form.goodwill_amortisation_account_code || null,
        sequence: form.sequence ? Number(form.sequence) : null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("rule_coi").update(payload).eq("id", row.id)
        : await supabase.from("rule_coi").insert({ ...payload, tenant_id: tenantId as string });
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
      const { error } = await supabase.from("rule_coi").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rule deleted");
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isPurchase = form.cons_method === "PURCHASE";
  const isEquity = form.cons_method === "EQUITY";

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
      <Field label="Consolidation method">
        <SelectField
          value={form.cons_method}
          onChange={(v) => setForm({ ...form, cons_method: v })}
          options={METHODS.map((m) => ({ value: m, label: m }))}
        />
      </Field>
      <Field label="Investment account">
        <SelectField
          value={form.investment_account_code}
          onChange={(v) => setForm({ ...form, investment_account_code: v })}
          options={accounts}
        />
      </Field>

      {!isEquity && (
        <>
          <Field label="Goodwill account">
            <SelectField
              value={form.goodwill_account_code}
              onChange={(v) => setForm({ ...form, goodwill_account_code: v })}
              options={accounts}
            />
          </Field>
          <Field
            label="Badwill account"
            hint="Used when goodwill comes out negative — a bargain purchase gain, taken to profit and loss."
          >
            <SelectField
              value={form.badwill_account_code}
              onChange={(v) => setForm({ ...form, badwill_account_code: v })}
              options={accounts}
            />
          </Field>
        </>
      )}

      {isPurchase && (
        <>
          <Field label="NCI equity account">
            <SelectField
              value={form.nci_equity_account_code}
              onChange={(v) => setForm({ ...form, nci_equity_account_code: v })}
              options={accounts}
            />
          </Field>
          <Field
            label="NCI profit and loss account"
            hint="The non-controlling share of the result is reported by this screen and by the statements; it is not posted as a separate journal."
          >
            <SelectField
              value={form.nci_pl_account_code}
              onChange={(v) => setForm({ ...form, nci_pl_account_code: v })}
              options={accounts}
            />
          </Field>
        </>
      )}

      {isEquity && (
        <>
          <Field label="Equity pickup account (balance sheet)">
            <SelectField
              value={form.equity_pickup_account_code}
              onChange={(v) => setForm({ ...form, equity_pickup_account_code: v })}
              options={accounts}
            />
          </Field>
          <Field label="Equity income account (profit and loss)">
            <SelectField
              value={form.equity_income_account_code}
              onChange={(v) => setForm({ ...form, equity_income_account_code: v })}
              options={accounts}
            />
          </Field>
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

/* ---------------------------------------------------------------- register */

function RegisterTab({
  tenantId,
  entities,
  groups,
}: {
  tenantId: string | null;
  entities: CodeRow[];
  groups: CodeRow[];
}) {
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    cons_group_id: pov.consGroupId ?? "",
    investor_entity_id: "",
    investee_entity_id: "",
    activity: "FIRST_CONSOLIDATION",
    cons_method: "PURCHASE",
    fiscal_year: pov.fiscalYear.toString(),
    period: pov.period.toString(),
    ownership_pct_before: "0",
    ownership_pct_after: "",
    investment_cost_gc: "",
    fair_value_adjustment_gc: "0",
    net_assets_acquired_gc: "",
    nci_measurement: "PROPORTIONATE",
    notes: "",
  });

  const key = ["investment_register", tenantId] as const;

  const rows = useQuery({
    queryKey: key,
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investment_register")
        .select("*")
        .order("fiscal_year", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Investment[];
    },
  });

  const label = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, e.code);
    for (const g of groups) map.set(g.id, g.code);
    return map;
  }, [entities, groups]);

  // Cost + fair value adjustment - the group's share of net assets = goodwill.
  const derivation = useMemo(() => {
    const cost = Number(form.investment_cost_gc || 0);
    const fva = Number(form.fair_value_adjustment_gc || 0);
    const na = Number(form.net_assets_acquired_gc || 0);
    const share = Number(form.ownership_pct_after || 0) / 100;
    const shareOfNa = na * share;
    return { cost, fva, shareOfNa, goodwill: cost + fva - shareOfNa };
  }, [
    form.investment_cost_gc,
    form.fair_value_adjustment_gc,
    form.net_assets_acquired_gc,
    form.ownership_pct_after,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.cons_group_id || !form.investor_entity_id || !form.investee_entity_id) {
        throw new Error("Consolidation group, investor and investee are required");
      }
      if (!form.ownership_pct_after) throw new Error("Ownership after is required");
      const { error } = await supabase.from("investment_register").insert({
        tenant_id: tenantId as string,
        cons_group_id: form.cons_group_id,
        investor_entity_id: form.investor_entity_id,
        investee_entity_id: form.investee_entity_id,
        activity: form.activity,
        cons_method: form.cons_method,
        fiscal_year: Number(form.fiscal_year),
        period: Number(form.period),
        ownership_pct_before: Number(form.ownership_pct_before || 0),
        ownership_pct_after: Number(form.ownership_pct_after),
        investment_cost_gc: form.investment_cost_gc ? Number(form.investment_cost_gc) : null,
        fair_value_adjustment_gc: Number(form.fair_value_adjustment_gc || 0),
        net_assets_acquired_gc: form.net_assets_acquired_gc
          ? Number(form.net_assets_acquired_gc)
          : null,
        nci_measurement: form.nci_measurement,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Activity added");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("investment_register").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Activity removed");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Acquisition facts the engine cannot derive from the balances. Leaving net assets acquired
          empty makes the run treat the period as a first consolidation and derive them from current
          equity.
        </p>
        <Button size="sm" className="h-8" disabled={!tenantId} onClick={() => setAdding(true)}>
          <Plus className="mr-1 size-3.5" /> Add activity
        </Button>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Group</TableHead>
              <TableHead className="h-8">Investor</TableHead>
              <TableHead className="h-8">Investee</TableHead>
              <TableHead className="h-8">Activity</TableHead>
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8 text-right">Own %</TableHead>
              <TableHead className="h-8 text-right">Cost</TableHead>
              <TableHead className="h-8 text-right">Net assets</TableHead>
              <TableHead className="h-8 text-right">Goodwill</TableHead>
              <TableHead className="h-8 w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-xs text-muted-foreground">
                  {rows.isLoading ? "Loading…" : "No investment activities recorded."}
                </TableCell>
              </TableRow>
            )}
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.id} className="text-xs">
                <TableCell>{label.get(row.cons_group_id) ?? "—"}</TableCell>
                <TableCell>{label.get(row.investor_entity_id) ?? "—"}</TableCell>
                <TableCell className="font-medium">
                  {label.get(row.investee_entity_id) ?? "—"}
                </TableCell>
                <TableCell>{row.activity}</TableCell>
                <TableCell>
                  {row.fiscal_year}/{row.period}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.ownership_pct_after}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.investment_cost_gc)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.net_assets_acquired_gc)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(row.goodwill_gc)}</TableCell>
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
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="text-sm">Add investment activity</SheetTitle>
            <SheetDescription className="text-xs">
              Goodwill is derived live from the figures below.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
            <Field label="Consolidation group">
              <SelectField
                value={form.cons_group_id}
                onChange={(v) => setForm({ ...form, cons_group_id: v })}
                options={groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name ?? ""}` }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Investor">
                <SelectField
                  value={form.investor_entity_id}
                  onChange={(v) => setForm({ ...form, investor_entity_id: v })}
                  options={entities.map((e) => ({ value: e.id, label: e.code }))}
                />
              </Field>
              <Field label="Investee">
                <SelectField
                  value={form.investee_entity_id}
                  onChange={(v) => setForm({ ...form, investee_entity_id: v })}
                  options={entities.map((e) => ({ value: e.id, label: e.code }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Activity">
                <SelectField
                  value={form.activity}
                  onChange={(v) => setForm({ ...form, activity: v })}
                  options={ACTIVITIES.map((a) => ({ value: a, label: a }))}
                />
              </Field>
              <Field label="Method">
                <SelectField
                  value={form.cons_method}
                  onChange={(v) => setForm({ ...form, cons_method: v })}
                  options={METHODS.map((m) => ({ value: m, label: m }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fiscal year">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.fiscal_year}
                  onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}
                />
              </Field>
              <Field label="Period">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ownership before %">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.ownership_pct_before}
                  onChange={(e) => setForm({ ...form, ownership_pct_before: e.target.value })}
                />
              </Field>
              <Field label="Ownership after %">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.ownership_pct_after}
                  onChange={(e) => setForm({ ...form, ownership_pct_after: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Investment cost (GC)">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.investment_cost_gc}
                  onChange={(e) => setForm({ ...form, investment_cost_gc: e.target.value })}
                />
              </Field>
              <Field label="Fair value adjustment (GC)">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.fair_value_adjustment_gc}
                  onChange={(e) => setForm({ ...form, fair_value_adjustment_gc: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Net assets acquired (GC)"
                hint="Leave empty to derive from current equity."
              >
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={form.net_assets_acquired_gc}
                  onChange={(e) => setForm({ ...form, net_assets_acquired_gc: e.target.value })}
                />
              </Field>
              <Field label="NCI measurement">
                <SelectField
                  value={form.nci_measurement}
                  onChange={(v) => setForm({ ...form, nci_measurement: v })}
                  options={NCI_MEASUREMENTS.map((n) => ({ value: n, label: n }))}
                />
              </Field>
            </div>

            <div className="rounded border bg-muted/30 p-3">
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                Goodwill derivation
              </p>
              <dl className="flex flex-col gap-1 text-xs">
                <div className="flex justify-between">
                  <dt>Investment cost</dt>
                  <dd className="tabular-nums">{money(derivation.cost)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>+ Fair value adjustment</dt>
                  <dd className="tabular-nums">{money(derivation.fva)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>− Share of net assets</dt>
                  <dd className="tabular-nums">{money(derivation.shareOfNa)}</dd>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1 font-medium">
                  <dt>= Goodwill</dt>
                  <dd
                    className={`tabular-nums ${derivation.goodwill < 0 ? "text-amber-600 dark:text-amber-400" : ""}`}
                  >
                    {money(derivation.goodwill)}
                  </dd>
                </div>
              </dl>
              {derivation.goodwill < 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Negative goodwill is a bargain purchase gain and is taken to profit and loss via
                  the badwill account.
                </p>
              )}
            </div>

            <Field label="Notes">
              <Textarea
                className="min-h-16 text-xs"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>

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

function RunTab({ tenantId, entities }: { tenantId: string | null; entities: CodeRow[] }) {
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<RunResult[]>([]);
  const { versionId, fiscalYear, period, consGroupId } = pov;

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, `${e.code} — ${e.name ?? ""}`);
    return map;
  }, [entities]);

  const runsKey = ["task_run", "COI", tenantId, versionId, fiscalYear, period] as const;

  const runs = useQuery({
    queryKey: runsKey,
    enabled: Boolean(tenantId && versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_run")
        .select("*")
        .eq("task_type", "COI")
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
      if (!consGroupId) throw new Error("Select a consolidation group in the point of view first");
      const { data, error } = await supabase.rpc("run_coi", {
        p_version: versionId,
        p_year: fiscalYear,
        p_period: period,
        p_cons_group: consGroupId,
      });
      if (error) throw error;
      return (data ?? []) as RunResult[];
    },
    onSuccess: (data) => {
      setResults(data);
      const failed = data.filter((r) => r.status === "ERROR");
      if (failed.length) toast.error(failed[0]?.message ?? "Consolidation of investments failed");
      else toast.success(`Consolidated ${data.length} investment(s)`);
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
          <h2 className="text-sm font-semibold">Run consolidation of investments</h2>
          <p className="text-xs text-muted-foreground">
            Runs for every member of the consolidation group except the parent, at {fiscalYear}/
            {period}. Currency translation has to have run first.
          </p>
        </div>
        <Button
          size="sm"
          className="h-8"
          disabled={run.isPending || !versionId || !consGroupId}
          onClick={() => run.mutate()}
        >
          <Play className="mr-1 size-3.5" /> Run
        </Button>
      </div>

      {results.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8">Investee</TableHead>
                <TableHead className="h-8">Method</TableHead>
                <TableHead className="h-8 text-right">Share %</TableHead>
                <TableHead className="h-8 text-right">Investment</TableHead>
                <TableHead className="h-8 text-right">Net assets</TableHead>
                <TableHead className="h-8 text-right">Goodwill</TableHead>
                <TableHead className="h-8 text-right">NCI equity</TableHead>
                <TableHead className="h-8 text-right">NCI result</TableHead>
                <TableHead className="h-8 text-right">Equity pickup</TableHead>
                <TableHead className="h-8 text-right">Residual</TableHead>
                <TableHead className="h-8">Status</TableHead>
                <TableHead className="h-8">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.task_run_id} className="text-xs">
                  <TableCell className="font-medium">
                    {r.investee_code} — {r.investee_name ?? ""}
                  </TableCell>
                  <TableCell>{r.cons_method}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.group_share_pct ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.investment_gc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.net_assets_gc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.goodwill_gc)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.nci_equity_gc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.nci_pl_gc)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.equity_pickup_gc)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.residual_gc && Math.abs(r.residual_gc) > 0
                        ? "font-medium text-destructive"
                        : ""
                    }`}
                  >
                    {money(r.residual_gc)}
                  </TableCell>
                  <TableCell className={r.status === "ERROR" ? "font-medium text-destructive" : ""}>
                    {r.status}
                  </TableCell>
                  <TableCell className="max-w-72 text-muted-foreground">
                    {r.message ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            Residual is the group&apos;s share of the investee&apos;s post-acquisition reserves. It
            is zero on a first consolidation; a figure here on a proportionate investee is the
            equity effect of scaling its result back to the group&apos;s share.
          </p>
        </div>
      )}

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Started</TableHead>
              <TableHead className="h-8">Investee</TableHead>
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
                  No consolidation-of-investments runs for this point of view.
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

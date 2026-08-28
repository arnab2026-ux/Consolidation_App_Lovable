import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { CrudTable } from "@/components/crud-table";
import { BoolCell, Field, SelectField } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pick, parseBool, type CsvRow } from "@/lib/csv";
import type { Tables } from "@/types/db";

type Account = Tables<"dim_account">;

const STATEMENT_TYPES = ["BS", "PL", "OCI", "CF", "STAT"];
const ACCOUNT_CLASSES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "STATISTICAL"];
const NORMAL_BALANCES = [
  { value: "D", label: "D — Debit" },
  { value: "C", label: "C — Credit" },
];
const TRANSLATION_METHODS = ["CLOSING", "AVERAGE", "HISTORICAL", "NONE"];

const FLAGS = [
  { key: "is_investment_account", label: "Investment" },
  { key: "is_equity_account", label: "Equity" },
  { key: "is_retained_earnings", label: "Retained Earnings" },
  { key: "is_net_income", label: "Net Income" },
] as const;

/** Flags that may only exist once per tenant. */
const SINGLETON_FLAGS = ["is_net_income", "is_retained_earnings"] as const;

async function assertSingletonFlags(form: Record<string, unknown>, tenantId: string, rowId: string | null) {
  for (const flag of SINGLETON_FLAGS) {
    if (!form[flag]) continue;
    let q = supabase.from("dim_account").select("code").eq("tenant_id", tenantId).eq(flag, true);
    if (rowId) q = q.neq("id", rowId);
    const { data, error } = await q.limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      throw new Error(`Account ${data[0]!.code} already carries ${flag}; only one account per tenant may.`);
    }
  }
}

export function AccountTab() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;

  const columns = useMemo<ColumnDef<Account, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="font-medium">{String(c.getValue() ?? "")}</span> },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "statement_type", header: "Statement Type" },
      { accessorKey: "account_class", header: "Class" },
      { accessorKey: "normal_balance", header: "Normal Balance" },
      { accessorKey: "requires_partner", header: "Req. Partner", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
      { accessorKey: "requires_movement", header: "Req. Movement", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
      { accessorKey: "elimination_group", header: "Elimination Group", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "translation_method", header: "Translation Method", cell: (c) => String(c.getValue() ?? "—") },
      {
        id: "flags",
        header: "Behaviour",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {FLAGS.filter((flag) => row.original[flag.key]).map((flag) => (
              <Badge key={flag.key} variant="secondary" className="rounded px-1.5 py-0 text-[10px] font-normal">
                {flag.label}
              </Badge>
            ))}
          </div>
        ),
      },
      { accessorKey: "is_active", header: "Active", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
    ],
    [],
  );

  const importValidator = (row: CsvRow) => {
    const code = pick(row, "code");
    const name = pick(row, "name");
    const statement = pick(row, "statement_type").toUpperCase();
    const cls = pick(row, "account_class", "class").toUpperCase();
    const balance = pick(row, "normal_balance").toUpperCase();
    const errors: string[] = [];
    if (!code) errors.push("Code is required");
    if (!name) errors.push("Name is required");
    if (!STATEMENT_TYPES.includes(statement)) errors.push(`Statement type must be one of ${STATEMENT_TYPES.join("/")}`);
    if (!ACCOUNT_CLASSES.includes(cls)) errors.push(`Class must be one of ${ACCOUNT_CLASSES.join("/")}`);
    if (!NORMAL_BALANCES.some((b) => b.value === balance)) errors.push("Normal balance must be D or C");
    const method = pick(row, "translation_method").toUpperCase();
    if (method && !TRANSLATION_METHODS.includes(method)) errors.push(`Unknown translation method ${method}`);
    return {
      errors,
      record: errors.length
        ? null
        : {
            code,
            name,
            statement_type: statement,
            account_class: cls,
            normal_balance: balance,
            requires_partner: parseBool(pick(row, "requires_partner")),
            requires_movement: parseBool(pick(row, "requires_movement")),
            elimination_group: pick(row, "elimination_group") || null,
            translation_method: method || null,
            is_investment_account: parseBool(pick(row, "is_investment_account")),
            is_equity_account: parseBool(pick(row, "is_equity_account")),
            is_retained_earnings: parseBool(pick(row, "is_retained_earnings")),
            is_net_income: parseBool(pick(row, "is_net_income")),
            is_active: parseBool(pick(row, "is_active", "active"), true),
          },
    };
  };

  return (
    <CrudTable<Account>
      table="dim_account"
      title="Account"
      tenantId={tenantId}
      columns={columns}
      searchColumns={["code", "name"]}
      filters={[
        { column: "code", label: "Code filter" },
        { column: "statement_type", label: "Statement" },
        { column: "account_class", label: "Class" },
      ]}
      orderBy={{ column: "code" }}
      conflictTarget="tenant_id,code"
      csvColumns={[
        { key: "code", label: "code" },
        { key: "name", label: "name" },
        { key: "statement_type", label: "statement_type" },
        { key: "account_class", label: "account_class" },
        { key: "normal_balance", label: "normal_balance" },
        { key: "requires_partner", label: "requires_partner" },
        { key: "requires_movement", label: "requires_movement" },
        { key: "elimination_group", label: "elimination_group" },
        { key: "translation_method", label: "translation_method" },
        { key: "is_investment_account", label: "is_investment_account" },
        { key: "is_equity_account", label: "is_equity_account" },
        { key: "is_retained_earnings", label: "is_retained_earnings" },
        { key: "is_net_income", label: "is_net_income" },
        { key: "is_active", label: "is_active" },
      ]}
      importValidator={importValidator}
      renderForm={({ row, close }) => <AccountForm row={row} close={close} tenantId={tenantId} />}
    />
  );
}

function AccountForm({ row, close, tenantId }: { row: Account | null; close: () => void; tenantId: string | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    statement_type: row?.statement_type ?? "",
    account_class: row?.account_class ?? "",
    normal_balance: row?.normal_balance ?? "",
    requires_partner: row?.requires_partner ?? false,
    requires_movement: row?.requires_movement ?? false,
    elimination_group: row?.elimination_group ?? "",
    translation_method: row?.translation_method ?? "",
    is_investment_account: row?.is_investment_account ?? false,
    is_equity_account: row?.is_equity_account ?? false,
    is_retained_earnings: row?.is_retained_earnings ?? false,
    is_net_income: row?.is_net_income ?? false,
    is_active: row?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.statement_type || !form.account_class || !form.normal_balance) {
        throw new Error("Code, name, statement type, class and normal balance are required");
      }
      await assertSingletonFlags(form, tenantId as string, row?.id ?? null);
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        statement_type: form.statement_type,
        account_class: form.account_class,
        normal_balance: form.normal_balance,
        requires_partner: form.requires_partner,
        requires_movement: form.requires_movement,
        elimination_group: form.elimination_group || null,
        translation_method: form.translation_method || null,
        is_investment_account: form.is_investment_account,
        is_equity_account: form.is_equity_account,
        is_retained_earnings: form.is_retained_earnings,
        is_net_income: form.is_net_income,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("dim_account").update(payload).eq("id", row.id)
        : await supabase.from("dim_account").insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Account updated" : "Account created");
      void queryClient.invalidateQueries({ queryKey: ["dim_account"] });
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <Field label="Code">
        <Input className="h-8 text-xs" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
      </Field>
      <Field label="Name">
        <Input className="h-8 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Statement Type">
        <SelectField
          value={form.statement_type}
          onChange={(v) => setForm({ ...form, statement_type: v })}
          options={STATEMENT_TYPES.map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <Field label="Class">
        <SelectField
          value={form.account_class}
          onChange={(v) => setForm({ ...form, account_class: v })}
          options={ACCOUNT_CLASSES.map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <Field label="Normal Balance">
        <SelectField
          value={form.normal_balance}
          onChange={(v) => setForm({ ...form, normal_balance: v })}
          options={NORMAL_BALANCES}
        />
      </Field>
      <Field label="Elimination Group">
        <Input
          className="h-8 text-xs"
          value={form.elimination_group}
          onChange={(e) => setForm({ ...form, elimination_group: e.target.value })}
        />
      </Field>
      <Field label="Translation Method">
        <SelectField
          value={form.translation_method}
          onChange={(v) => setForm({ ...form, translation_method: v })}
          options={TRANSLATION_METHODS.map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <div className="flex flex-col gap-2 rounded border p-3">
        <span className="text-xs font-medium">Requirements</span>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={form.requires_partner}
            onCheckedChange={(v) => setForm({ ...form, requires_partner: Boolean(v) })}
          />
          Requires partner
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={form.requires_movement}
            onCheckedChange={(v) => setForm({ ...form, requires_movement: Boolean(v) })}
          />
          Requires movement type
        </label>
      </div>
      <div className="flex flex-col gap-2 rounded border p-3">
        <span className="text-xs font-medium">Behaviour flags</span>
        {FLAGS.map((flag) => (
          <label key={flag.key} className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={Boolean(form[flag.key])}
              onCheckedChange={(v) => setForm({ ...form, [flag.key]: Boolean(v) })}
            />
            {flag.label}
            {SINGLETON_FLAGS.includes(flag.key as (typeof SINGLETON_FLAGS)[number]) && (
              <span className="text-[11px] text-muted-foreground">(one per tenant)</span>
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between rounded border px-3 py-2">
        <span className="text-xs">Active</span>
        <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" className="h-8" onClick={close}>
          Cancel
        </Button>
        <Button size="sm" className="h-8" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </div>
  );
}

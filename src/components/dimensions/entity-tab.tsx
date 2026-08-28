import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { CrudTable } from "@/components/crud-table";
import { BoolCell, Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pick, parseBool, type CsvRow } from "@/lib/csv";
import type { Tables } from "@/types/db";

type Entity = Tables<"dim_entity">;

export const ENTITY_TYPES = ["PARENT", "SUBSIDIARY", "JV", "ASSOCIATE", "ELIMINATION", "ADJUSTMENT"];
export const CONS_METHODS = ["PURCHASE", "PROPORTIONATE", "EQUITY", "NONE"];


function useCurrencies() {
  return useQuery({
    queryKey: ["dim_currency"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_currency").select("*").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function EntityTab() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const currencies = useCurrencies();
  const currencyCodes = useMemo(() => (currencies.data ?? []).map((c) => c.code), [currencies.data]);

  const columns = useMemo<ColumnDef<Entity, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="font-medium">{String(c.getValue() ?? "")}</span> },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "local_currency", header: "Local Currency" },
      { accessorKey: "country", header: "Country", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "entity_type", header: "Type", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "default_cons_method", header: "Default Method", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "acquisition_date", header: "Acquisition Date", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "is_active", header: "Active", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
    ],
    [],
  );

  const importValidator = (row: CsvRow) => {
    const code = pick(row, "code");
    const name = pick(row, "name");
    const currency = pick(row, "local_currency", "currency").toUpperCase();
    const errors: string[] = [];
    if (!code) errors.push("Code is required");
    if (!name) errors.push("Name is required");
    if (!currency) errors.push("Local currency is required");
    else if (currencyCodes.length > 0 && !currencyCodes.includes(currency)) errors.push(`Unknown currency ${currency}`);
    const method = pick(row, "default_cons_method", "method").toUpperCase();
    if (method && !CONS_METHODS.includes(method)) errors.push(`Unknown method ${method}`);
    const type = pick(row, "entity_type", "type").toUpperCase();
    const acq = pick(row, "acquisition_date");
    if (acq && Number.isNaN(Date.parse(acq))) errors.push("Acquisition date is not a valid date");
    return {
      errors,
      record: errors.length
        ? null
        : {
            code,
            name,
            local_currency: currency,
            country: pick(row, "country") || null,
            entity_type: type || null,
            default_cons_method: method || null,
            acquisition_date: acq || null,
            is_active: parseBool(pick(row, "is_active", "active"), true),
          },
    };
  };

  return (
    <CrudTable<Entity>
      table="dim_entity"
      title="Entity"
      tenantId={tenantId}
      columns={columns}
      searchColumns={["code", "name"]}
      filters={[
        { column: "code", label: "Code filter" },
        { column: "local_currency", label: "Currency" },
        { column: "entity_type", label: "Type" },
      ]}
      orderBy={{ column: "code" }}
      conflictTarget="tenant_id,code"
      csvColumns={[
        { key: "code", label: "code" },
        { key: "name", label: "name" },
        { key: "local_currency", label: "local_currency" },
        { key: "country", label: "country" },
        { key: "entity_type", label: "entity_type" },
        { key: "default_cons_method", label: "default_cons_method" },
        { key: "acquisition_date", label: "acquisition_date" },
        { key: "is_active", label: "is_active" },
      ]}
      importValidator={importValidator}
      renderForm={({ row, close }) => (
        <EntityForm row={row} close={close} tenantId={tenantId} currencyCodes={currencyCodes} />
      )}
    />
  );
}

function EntityForm({
  row,
  close,
  tenantId,
  currencyCodes,
}: {
  row: Entity | null;
  close: () => void;
  tenantId: string | null;
  currencyCodes: string[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    local_currency: row?.local_currency ?? "",
    country: row?.country ?? "",
    entity_type: row?.entity_type ?? "",
    default_cons_method: row?.default_cons_method ?? "",
    acquisition_date: row?.acquisition_date ?? "",
    is_active: row?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.local_currency) {
        throw new Error("Code, name and local currency are required");
      }
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        local_currency: form.local_currency,
        country: form.country || null,
        entity_type: form.entity_type || null,
        default_cons_method: form.default_cons_method || null,
        acquisition_date: form.acquisition_date || null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("dim_entity").update(payload).eq("id", row.id)
        : await supabase.from("dim_entity").insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Entity updated" : "Entity created");
      void queryClient.invalidateQueries({ queryKey: ["dim_entity"] });
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <Field label="Code">
        <Input
          className="h-8 text-xs"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
      </Field>
      <Field label="Name">
        <Input className="h-8 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Local Currency">
        <SelectField
          value={form.local_currency}
          onChange={(v) => setForm({ ...form, local_currency: v })}
          options={currencyCodes.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="Country">
        <Input
          className="h-8 text-xs"
          value={form.country}
          onChange={(e) => setForm({ ...form, country: e.target.value })}
        />
      </Field>
      <Field label="Type">
        <SelectField
          value={form.entity_type}
          onChange={(v) => setForm({ ...form, entity_type: v })}
          options={ENTITY_TYPES.map((t) => ({ value: t, label: t }))}
        />
      </Field>
      <Field label="Default Consolidation Method">
        <SelectField
          value={form.default_cons_method}
          onChange={(v) => setForm({ ...form, default_cons_method: v })}
          options={CONS_METHODS.map((m) => ({ value: m, label: m }))}
        />
      </Field>
      <Field label="Acquisition Date">
        <Input
          type="date"
          className="h-8 text-xs"
          value={form.acquisition_date}
          onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })}
        />
      </Field>
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

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { CrudTable } from "@/components/crud-table";
import { BoolCell, Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pick, parseBool, type CsvRow } from "@/lib/csv";
import type { Tables } from "@/types/db";

type Member = Tables<"dim_generic_member">;

/** Read/write `dim_generic_member` for one custom dimension. */
export function GenericDimensionTab({ dimCode, dimName }: { dimCode: string; dimName: string }) {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;

  const columns = useMemo<ColumnDef<Member, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="font-medium">{String(c.getValue() ?? "")}</span> },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "parent_code", header: "Parent", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "is_active", header: "Active", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
    ],
    [],
  );

  const importValidator = (row: CsvRow) => {
    const code = pick(row, "code");
    const name = pick(row, "name");
    const errors: string[] = [];
    if (!code) errors.push("Code is required");
    if (!name) errors.push("Name is required");
    const parent = pick(row, "parent_code", "parent");
    if (parent && parent === code) errors.push("A member cannot be its own parent");
    return {
      errors,
      record: errors.length
        ? null
        : {
            dim_code: dimCode,
            code,
            name,
            parent_code: parent || null,
            is_active: parseBool(pick(row, "is_active", "active"), true),
          },
    };
  };

  return (
    <CrudTable<Member>
      key={dimCode}
      table="dim_generic_member"
      title={dimName}
      tenantId={tenantId}
      eqFilters={{ dim_code: dimCode }}
      columns={columns}
      searchColumns={["code", "name"]}
      filters={[
        { column: "code", label: "Code filter" },
        { column: "parent_code", label: "Parent" },
      ]}
      orderBy={{ column: "code" }}
      conflictTarget="tenant_id,dim_code,code"
      csvColumns={[
        { key: "code", label: "code" },
        { key: "name", label: "name" },
        { key: "parent_code", label: "parent_code" },
        { key: "is_active", label: "is_active" },
      ]}
      importValidator={importValidator}
      renderForm={({ row, close }) => (
        <GenericForm row={row} close={close} tenantId={tenantId} dimCode={dimCode} />
      )}
    />
  );
}

function GenericForm({
  row,
  close,
  tenantId,
  dimCode,
}: {
  row: Member | null;
  close: () => void;
  tenantId: string | null;
  dimCode: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    parent_code: row?.parent_code ?? "",
    is_active: row?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim()) throw new Error("Code and name are required");
      if (form.parent_code.trim() && form.parent_code.trim() === form.code.trim()) {
        throw new Error("A member cannot be its own parent");
      }
      const payload = {
        dim_code: dimCode,
        code: form.code.trim(),
        name: form.name.trim(),
        parent_code: form.parent_code.trim() || null,
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("dim_generic_member").update(payload).eq("id", row.id)
        : await supabase.from("dim_generic_member").insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Member updated" : "Member created");
      void queryClient.invalidateQueries({ queryKey: ["dim_generic_member"] });
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
      <Field label="Parent" hint="Code of the parent member in this dimension.">
        <Input
          className="h-8 text-xs"
          value={form.parent_code}
          onChange={(e) => setForm({ ...form, parent_code: e.target.value })}
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

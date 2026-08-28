import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

import { CrudTable } from "@/components/crud-table";
import { BoolCell, Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pick, parseBool, parseNum, type CsvRow } from "@/lib/csv";
import type { Tables } from "@/types/db";

type Movement = Tables<"dim_movement">;

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

const STANDARD_MOVEMENTS = [
  { code: "100", name: "Opening Balance", movement_class: "OPENING", is_bcf_target: true, is_bcf_source: false, display_order: 10 },
  { code: "120", name: "Additions", movement_class: "ADDITION", is_bcf_target: false, is_bcf_source: false, display_order: 20 },
  { code: "130", name: "Disposals", movement_class: "DISPOSAL", is_bcf_target: false, is_bcf_source: false, display_order: 30 },
  { code: "140", name: "Transfers", movement_class: "TRANSFER", is_bcf_target: false, is_bcf_source: false, display_order: 40 },
  { code: "150", name: "FX Effect", movement_class: "FX_EFFECT", is_bcf_target: false, is_bcf_source: false, display_order: 50 },
  { code: "160", name: "Scope Change", movement_class: "SCOPE_CHANGE", is_bcf_target: false, is_bcf_source: false, display_order: 60 },
  { code: "199", name: "Closing Balance", movement_class: "CLOSING", is_bcf_target: false, is_bcf_source: true, display_order: 70 },
];


export function MovementTab() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const queryClient = useQueryClient();

  const columns = useMemo<ColumnDef<Movement, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="font-medium">{String(c.getValue() ?? "")}</span> },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "movement_class", header: "Class" },
      { accessorKey: "is_bcf_source", header: "BCF Source", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
      { accessorKey: "is_bcf_target", header: "BCF Target", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
      { accessorKey: "display_order", header: "Display Order", cell: (c) => String(c.getValue() ?? "—") },
    ],
    [],
  );

  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("dim_movement")
        .upsert(
          STANDARD_MOVEMENTS.map((m) => ({ ...m, tenant_id: tenantId as string })),
          { onConflict: "tenant_id,code" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Standard movement types loaded");
      void queryClient.invalidateQueries({ queryKey: ["dim_movement"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importValidator = (row: CsvRow) => {
    const code = pick(row, "code");
    const name = pick(row, "name");
    const cls = pick(row, "movement_class", "class").toUpperCase();
    const errors: string[] = [];
    if (!code) errors.push("Code is required");
    if (!name) errors.push("Name is required");
    if (!MOVEMENT_CLASSES.includes(cls)) errors.push(`Class must be one of ${MOVEMENT_CLASSES.join("/")}`);
    return {
      errors,
      record: errors.length
        ? null
        : {
            code,
            name,
            movement_class: cls,
            is_bcf_source: parseBool(pick(row, "is_bcf_source", "bcf_source")),
            is_bcf_target: parseBool(pick(row, "is_bcf_target", "bcf_target")),
            display_order: parseNum(pick(row, "display_order")),
          },
    };
  };

  return (
    <CrudTable<Movement>
      table="dim_movement"
      title="Movement Type"
      tenantId={tenantId}
      columns={columns}
      searchColumns={["code", "name"]}
      filters={[
        { column: "code", label: "Code filter" },
        { column: "movement_class", label: "Class" },
      ]}
      orderBy={{ column: "display_order" }}
      conflictTarget="tenant_id,code"
      csvColumns={[
        { key: "code", label: "code" },
        { key: "name", label: "name" },
        { key: "movement_class", label: "movement_class" },
        { key: "is_bcf_source", label: "is_bcf_source" },
        { key: "is_bcf_target", label: "is_bcf_target" },
        { key: "display_order", label: "display_order" },
      ]}
      importValidator={importValidator}
      toolbar={
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={seed.isPending || !tenantId}
          onClick={() => seed.mutate()}
        >
          <Wand2 className="mr-1 size-3.5" /> Load standard movement types
        </Button>
      }
      renderForm={({ row, close }) => <MovementForm row={row} close={close} tenantId={tenantId} />}
    />
  );
}

function MovementForm({ row, close, tenantId }: { row: Movement | null; close: () => void; tenantId: string | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    movement_class: row?.movement_class ?? "",
    is_bcf_source: row?.is_bcf_source ?? false,
    is_bcf_target: row?.is_bcf_target ?? false,
    display_order: row?.display_order?.toString() ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.movement_class) {
        throw new Error("Code, name and class are required");
      }
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        movement_class: form.movement_class,
        is_bcf_source: form.is_bcf_source,
        is_bcf_target: form.is_bcf_target,
        display_order: form.display_order ? Number(form.display_order) : null,
      };
      const { error } = row
        ? await supabase.from("dim_movement").update(payload).eq("id", row.id)
        : await supabase.from("dim_movement").insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Movement type updated" : "Movement type created");
      void queryClient.invalidateQueries({ queryKey: ["dim_movement"] });
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
      <Field label="Class">
        <SelectField
          value={form.movement_class}
          onChange={(v) => setForm({ ...form, movement_class: v })}
          options={MOVEMENT_CLASSES.map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.is_bcf_source}
          onCheckedChange={(v) => setForm({ ...form, is_bcf_source: Boolean(v) })}
        />
        BCF source (carried forward from prior year)
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.is_bcf_target}
          onCheckedChange={(v) => setForm({ ...form, is_bcf_target: Boolean(v) })}
        />
        BCF target (receives the carry-forward)
      </label>
      <Field label="Display Order">
        <Input
          type="number"
          className="h-8 text-xs"
          value={form.display_order}
          onChange={(e) => setForm({ ...form, display_order: e.target.value })}
        />
      </Field>
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

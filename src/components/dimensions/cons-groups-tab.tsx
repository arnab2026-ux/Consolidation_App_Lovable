import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CrudTable } from "@/components/crud-table";
import { BoolCell, Field, SelectField } from "@/components/field";
import { CONS_METHODS } from "@/components/dimensions/entity-tab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pick, parseBool, type CsvRow } from "@/lib/csv";
import type { Tables } from "@/types/db";

type Group = Tables<"dim_cons_group">;
type Member = Tables<"cons_group_member">;

export function ConsGroupsTab() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const groups = useQuery({
    queryKey: ["dim_cons_group", "all", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_cons_group").select("*").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const list = groups.data ?? [];
    if (list.length === 0) {
      setSelectedGroup(null);
      return;
    }
    setSelectedGroup((current) => list.find((g) => g.id === current?.id) ?? list[0]!);
  }, [groups.data]);

  const columns = useMemo<ColumnDef<Group, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: (c) => <span className="font-medium">{String(c.getValue() ?? "")}</span> },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "group_currency", header: "Group Currency" },
      { accessorKey: "is_active", header: "Active", cell: (c) => <BoolCell value={c.getValue() as boolean} /> },
      {
        id: "__detail",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedGroup(row.original);
            }}
          >
            Members
          </Button>
        ),
      },
    ],
    [],
  );

  const importValidator = (row: CsvRow) => {
    const code = pick(row, "code");
    const name = pick(row, "name");
    const currency = pick(row, "group_currency", "currency").toUpperCase();
    const errors: string[] = [];
    if (!code) errors.push("Code is required");
    if (!name) errors.push("Name is required");
    if (!currency) errors.push("Group currency is required");
    return {
      errors,
      record: errors.length
        ? null
        : {
            code,
            name,
            group_currency: currency,
            is_active: parseBool(pick(row, "is_active", "active"), true),
          },
    };
  };

  return (
    <div className="flex flex-col gap-6">
      <CrudTable<Group>
        table="dim_cons_group"
        title="Consolidation Group"
        tenantId={tenantId}
        columns={columns}
        searchColumns={["code", "name"]}
        filters={[{ column: "code", label: "Code filter" }]}
        orderBy={{ column: "code" }}
        conflictTarget="tenant_id,code"
        csvColumns={[
          { key: "code", label: "code" },
          { key: "name", label: "name" },
          { key: "group_currency", label: "group_currency" },
          { key: "is_active", label: "is_active" },
        ]}
        importValidator={importValidator}
        onRowsChanged={() => void groups.refetch()}
        renderForm={({ row, close }) => <GroupForm row={row} close={close} tenantId={tenantId} />}
      />
      {selectedGroup && <MembershipGrid group={selectedGroup} tenantId={tenantId} />}
    </div>
  );
}

function GroupForm({ row, close, tenantId }: { row: Group | null; close: () => void; tenantId: string | null }) {
  const queryClient = useQueryClient();
  const currencies = useQuery({
    queryKey: ["dim_currency"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_currency").select("*").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    group_currency: row?.group_currency ?? "",
    is_active: row?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim() || !form.group_currency.trim()) {
        throw new Error("Code, name and group currency are required");
      }
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        group_currency: form.group_currency.trim().toUpperCase(),
        is_active: form.is_active,
      };
      const { error } = row
        ? await supabase.from("dim_cons_group").update(payload).eq("id", row.id)
        : await supabase.from("dim_cons_group").insert({ ...payload, tenant_id: tenantId as string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Group updated" : "Group created");
      void queryClient.invalidateQueries({ queryKey: ["dim_cons_group"] });
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
      <Field label="Group Currency">
        <SelectField
        value={form.group_currency}
        onChange={(v) => setForm({ ...form, group_currency: v })}
        options={(currencies.data ?? []).map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
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

interface DraftMember {
  id: string;
  entity_id: string;
  cons_method: string;
  direct_ownership_pct: string;
  group_share_pct: string;
  first_cons_year: string;
  first_cons_period: string;
  last_cons_year: string;
  last_cons_period: string;
  isNew?: boolean;
}

function toDraft(member: Member): DraftMember {
  return {
    id: member.id,
    entity_id: member.entity_id,
    cons_method: member.cons_method,
    direct_ownership_pct: String(member.direct_ownership_pct ?? ""),
    group_share_pct: String(member.group_share_pct ?? ""),
    first_cons_year: member.first_cons_year?.toString() ?? "",
    first_cons_period: member.first_cons_period?.toString() ?? "",
    last_cons_year: member.last_cons_year?.toString() ?? "",
    last_cons_period: member.last_cons_period?.toString() ?? "",
  };
}

function MembershipGrid({ group, tenantId }: { group: Group; tenantId: string | null }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<DraftMember[]>([]);

  const entities = useQuery({
    queryKey: ["dim_entity", "all", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_entity").select("id, code, name").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const members = useQuery({
    queryKey: ["cons_group_member", group.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("cons_group_member").select("*").eq("cons_group_id", group.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    setDrafts((members.data ?? []).map(toDraft));
  }, [members.data]);

  const entityLabel = (id: string) => {
    const entity = (entities.data ?? []).find((e) => e.id === id);
    return entity ? `${entity.code} — ${entity.name}` : id;
  };

  const rowIssues = (draft: DraftMember) => {
    const direct = Number(draft.direct_ownership_pct || 0);
    const share = Number(draft.group_share_pct || 0);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!draft.entity_id) errors.push("Entity is required");
    if (!draft.cons_method) errors.push("Method is required");
    if (direct < 0 || direct > 100) errors.push("Direct % must be between 0 and 100");
    if (share < 0 || share > 100) errors.push("Group share % must be between 0 and 100");
    if (share > direct + 0.0001) errors.push("Group share exceeds the direct ownership chain");
    if (draft.cons_method === "PURCHASE" && share < 50) warnings.push("PURCHASE method with group share below 50%");
    return { errors, warnings };
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const draft of drafts) {
        const { errors } = rowIssues(draft);
        if (errors.length) throw new Error(`${entityLabel(draft.entity_id)}: ${errors.join("; ")}`);
      }
      const payload = drafts.map((draft) => {
        return {
          ...(draft.isNew ? {} : { id: draft.id }),
          tenant_id: tenantId as string,
          cons_group_id: group.id,
          entity_id: draft.entity_id,
          cons_method: draft.cons_method,
          direct_ownership_pct: Number(draft.direct_ownership_pct || 0),
          group_share_pct: Number(draft.group_share_pct || 0),
          first_cons_year: draft.first_cons_year ? Number(draft.first_cons_year) : null,
          first_cons_period: draft.first_cons_period ? Number(draft.first_cons_period) : null,
          last_cons_year: draft.last_cons_year ? Number(draft.last_cons_year) : null,
          last_cons_period: draft.last_cons_period ? Number(draft.last_cons_period) : null,
        };
      });
      if (payload.length > 0) {
        const { error } = await supabase
          .from("cons_group_member")
          .upsert(payload, { onConflict: "tenant_id,cons_group_id,entity_id" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Membership saved");
      void queryClient.invalidateQueries({ queryKey: ["cons_group_member", group.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeRow = useMutation({
    mutationFn: async (draft: DraftMember) => {
      if (!draft.isNew) {
        const { error } = await supabase.from("cons_group_member").delete().eq("id", draft.id);
        if (error) throw error;
      }
    },
    onSuccess: (_data, draft) => {
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      void queryClient.invalidateQueries({ queryKey: ["cons_group_member", group.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const usedEntityIds = new Set(drafts.map((d) => d.entity_id));
  const warnings = drafts.flatMap((draft) => rowIssues(draft).warnings.map((w) => `${entityLabel(draft.entity_id)}: ${w}`));

  const update = (id: string, patch: Partial<DraftMember>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div>
          <h2 className="text-sm font-semibold">
            Membership · {group.code} — {group.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            Minority % is computed as 100 − group share. Group share may not exceed the direct ownership chain.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                {
                  id: `new-${crypto.randomUUID()}`,
                  entity_id: "",
                  cons_method: "PURCHASE",
                  direct_ownership_pct: "100",
                  group_share_pct: "100",
                  first_cons_year: "",
                  first_cons_period: "",
                  last_cons_year: "",
                  last_cons_period: "",
                  isNew: true,
                },
              ])
            }
          >
            <Plus className="mr-1 size-3.5" /> Add entity
          </Button>
          <Button size="sm" className="h-8" disabled={save.isPending} onClick={() => save.mutate()}>
            Save membership
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warnings.map((warning) => (
            <span key={warning} className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" /> {warning}
            </span>
          ))}
        </div>
      )}

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {["Entity", "Method", "Direct %", "Group Share %", "Minority %", "First Cons.", "Last Cons.", ""].map(
                (header) => (
                  <TableHead key={header} className="h-8 px-2 text-xs font-medium">
                    {header}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-16 text-center text-xs text-muted-foreground">
                  No entities assigned to this group.
                </TableCell>
              </TableRow>
            )}
            {drafts.map((draft) => {
              const { errors } = rowIssues(draft);
              const share = Number(draft.group_share_pct || 0);
              return (
                <TableRow key={draft.id} className={errors.length ? "bg-destructive/5" : undefined}>
                  <TableCell className="px-2 py-1">
                    <SelectField
                      value={draft.entity_id}
                      onChange={(v) => update(draft.id, { entity_id: v })}
                      options={(entities.data ?? [])
                        .filter((e) => e.id === draft.entity_id || !usedEntityIds.has(e.id))
                        .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` }))}
                      placeholder="Entity…"
                    />
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <SelectField
                      value={draft.cons_method}
                      onChange={(v) => update(draft.id, { cons_method: v })}
                      options={CONS_METHODS.map((m) => ({ value: m, label: m }))}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <Input
                      className="h-8 w-24 text-xs"
                      value={draft.direct_ownership_pct}
                      onChange={(e) => update(draft.id, { direct_ownership_pct: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <Input
                      className="h-8 w-24 text-xs"
                      value={draft.group_share_pct}
                      onChange={(e) => update(draft.id, { group_share_pct: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-1 text-xs tabular-nums">{(100 - share).toFixed(2)}</TableCell>
                  <TableCell className="px-2 py-1">
                    <div className="flex gap-1">
                      <Input
                        className="h-8 w-16 text-xs"
                        placeholder="Year"
                        value={draft.first_cons_year}
                        onChange={(e) => update(draft.id, { first_cons_year: e.target.value })}
                      />
                      <Input
                        className="h-8 w-14 text-xs"
                        placeholder="Per."
                        value={draft.first_cons_period}
                        onChange={(e) => update(draft.id, { first_cons_period: e.target.value })}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <div className="flex gap-1">
                      <Input
                        className="h-8 w-16 text-xs"
                        placeholder="Year"
                        value={draft.last_cons_year}
                        onChange={(e) => update(draft.id, { last_cons_year: e.target.value })}
                      />
                      <Input
                        className="h-8 w-14 text-xs"
                        placeholder="Per."
                        value={draft.last_cons_period}
                        onChange={(e) => update(draft.id, { last_cons_period: e.target.value })}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => removeRow.mutate(draft)}
                      aria-label="Remove entity"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {drafts.some((d) => rowIssues(d).errors.length > 0) && (
        <p className="text-xs text-destructive">
          Fix the highlighted rows before saving: {drafts.flatMap((d) => rowIssues(d).errors).join("; ")}
        </p>
      )}
    </div>
  );
}

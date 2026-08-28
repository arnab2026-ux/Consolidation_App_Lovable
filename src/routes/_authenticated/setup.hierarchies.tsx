import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field, SelectField } from "@/components/field";
import { HierarchyTreeEditor } from "@/components/hierarchy/hierarchy-tree";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useActiveDimensions } from "@/hooks/use-active-dimensions";
import { useAuth } from "@/hooks/use-auth";
import { MANDATORY_DIMENSIONS } from "@/lib/data-model";
import { supabase } from "@/integrations/supabase/client";
import type { HierarchyRow } from "@/lib/hierarchy";

const TITLE = "Hierarchies";
const DESCRIPTION = "Define and version reporting hierarchies per dimension.";

export const Route = createFileRoute("/_authenticated/setup/hierarchies")({
  head: () => ({
    meta: [
      { title: "Hierarchies | Consolidation" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Hierarchies | Consolidation" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HierarchiesPage,
});

function HierarchiesPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const dimensions = useActiveDimensions();
  const [dimCode, setDimCode] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dimOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>();
    // Entity, Account and Movement Type are always hierarchical, even before the
    // optional model is activated; registry rows add the rest in display order.
    for (const dim of MANDATORY_DIMENSIONS) {
      if (!["ENTITY", "ACCOUNT", "MOVEMENT"].includes(dim.code)) continue;
      options.set(dim.code, { value: dim.code, label: `${dim.code} — ${dim.name}` });
    }
    for (const dim of dimensions.data ?? []) {
      if (dim.is_hierarchical === false) continue;
      options.set(dim.dim_code, { value: dim.dim_code, label: `${dim.dim_code} — ${dim.dim_name}` });
    }
    return [...options.values()];
  }, [dimensions.data]);

  useEffect(() => {
    if (!dimCode && dimOptions.length > 0) setDimCode(dimOptions[0]!.value);
  }, [dimCode, dimOptions]);

  const hierarchies = useQuery({
    queryKey: ["dim_hierarchy", dimCode, tenantId],
    enabled: Boolean(tenantId && dimCode),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dim_hierarchy")
        .select("*")
        .eq("dim_code", dimCode)
        .order("hierarchy_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const list = hierarchies.data ?? [];
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => (list.some((h) => h.id === current) ? current : list[0]!.id));
  }, [hierarchies.data]);

  const selected = (hierarchies.data ?? []).find((h) => h.id === selectedId) ?? null;

  return (
    <PageShell
      title={TITLE}
      description={DESCRIPTION}
      actions={
        <div className="w-64">
          <Field label="Dimension">
            <SelectField value={dimCode} onChange={setDimCode} options={dimOptions} placeholder="Select dimension" />
          </Field>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <HierarchyList
          rows={hierarchies.data ?? []}
          loading={hierarchies.isLoading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          dimCode={dimCode}
          tenantId={tenantId}
        />
        {selected && tenantId ? (
          <HierarchyTreeEditor key={selected.id} hierarchy={selected} tenantId={tenantId} />
        ) : (
          <div className="rounded border border-dashed p-6 text-xs text-muted-foreground">
            Select or create a hierarchy for this dimension to edit its tree.
          </div>
        )}
      </div>
    </PageShell>
  );
}

function HierarchyList({
  rows,
  loading,
  selectedId,
  onSelect,
  dimCode,
  tenantId,
}: {
  rows: HierarchyRow[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dimCode: string;
  tenantId: string | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "" });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim()) throw new Error("Code and name are required");
      const { error } = await supabase.from("dim_hierarchy").insert({
        tenant_id: tenantId as string,
        dim_code: dimCode,
        hierarchy_code: form.code.trim().toUpperCase(),
        hierarchy_name: form.name.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hierarchy created");
      setForm({ code: "", name: "" });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["dim_hierarchy"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dim_hierarchy").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hierarchy deleted");
      void queryClient.invalidateQueries({ queryKey: ["dim_hierarchy"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-2 rounded border p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Hierarchies</span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!dimCode || !tenantId}>
              <Plus className="mr-1 size-3.5" /> New
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[380px] sm:max-w-[380px]">
            <SheetHeader>
              <SheetTitle className="text-sm">New hierarchy</SheetTitle>
              <SheetDescription className="text-xs">
                Hierarchy for dimension {dimCode || "—"}.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4">
              <Field label="Code">
                <Input
                  className="h-8 text-xs"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </Field>
              <Field label="Name">
                <Input
                  className="h-8 text-xs"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-8" disabled={create.isPending} onClick={() => create.mutate()}>
                  Save
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {loading && <p className="px-1 text-xs text-muted-foreground">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">No hierarchies for this dimension yet.</p>
      )}
      {rows.map((row) => (
        <div
          key={row.id}
          className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
            row.id === selectedId ? "border-foreground bg-muted" : "border-transparent hover:bg-muted/60"
          }`}
        >
          <button className="flex-1 text-left" onClick={() => onSelect(row.id)}>
            <span className="font-medium">{row.hierarchy_code}</span>
            <span className="ml-2 text-muted-foreground">{row.hierarchy_name}</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1"
            onClick={() => remove.mutate(row.id)}
            aria-label={`Delete ${row.hierarchy_code}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/types/db";

type Template = Tables<"workflow_template">;
type Step = Tables<"workflow_step">;

const TASK_TYPES = [
  "DATA_UPLOAD",
  "VALIDATION",
  "BCF",
  "NET_INCOME",
  "TRANSLATION",
  "IC_RECON",
  "IC_ELIM",
  "COI",
  "MANUAL_ADJ",
  "GROUP_REPORT",
  "LOCK_PERIOD",
];

const TITLE = "Workflow Templates | Consolidation";
const DESCRIPTION = "The ordered steps a close runs, and what each one waits for.";

export const Route = createFileRoute("/_authenticated/process/workflow-templates")({
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
  component: TemplatesPage,
});

function TemplatesPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: Step | null } | null>(null);

  const templates = useQuery({
    queryKey: ["workflow_template", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_template").select("*").order("code");
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const activeTemplate = selected ?? templates.data?.[0]?.id ?? null;

  const stepsKey = ["workflow_step", activeTemplate] as const;

  const steps = useQuery({
    queryKey: stepsKey,
    enabled: Boolean(activeTemplate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_step")
        .select("*")
        .eq("template_id", activeTemplate as string)
        .order("step_no");
      if (error) throw error;
      return (data ?? []) as Step[];
    },
  });

  const loadStandard = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("seed_standard_workflow_template");
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (id) => {
      setSelected(id);
      toast.success("Standard close template loaded");
      void queryClient.invalidateQueries({ queryKey: ["workflow_template", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["workflow_step", id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const move = useMutation({
    mutationFn: async ({ step, delta }: { step: Step; delta: number }) => {
      const list = steps.data ?? [];
      const index = list.findIndex((s) => s.id === step.id);
      const swapWith = list[index + delta];
      if (!swapWith) return;
      // step_no is unique per template, so park one out of the way first.
      const parked = -Math.abs(step.step_no) - 1000;
      const a = await supabase.from("workflow_step").update({ step_no: parked }).eq("id", step.id);
      if (a.error) throw a.error;
      const b = await supabase
        .from("workflow_step")
        .update({ step_no: step.step_no })
        .eq("id", swapWith.id);
      if (b.error) throw b.error;
      const c = await supabase
        .from("workflow_step")
        .update({ step_no: swapWith.step_no })
        .eq("id", step.id);
      if (c.error) throw c.error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stepsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workflow_step").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Step removed");
      void queryClient.invalidateQueries({ queryKey: stepsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <PageShell
      title="Workflow Templates"
      description={DESCRIPTION}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!tenantId || loadStandard.isPending}
            onClick={() => loadStandard.mutate()}
          >
            <Sparkles className="mr-1 size-3.5" /> Load standard close
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!activeTemplate}
            onClick={() => setEditing({ row: null })}
          >
            <Plus className="mr-1 size-3.5" /> New step
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <div className="rounded border">
          <div className="border-b px-3 py-2 text-xs font-semibold">Templates</div>
          <ul className="text-xs">
            {(templates.data ?? []).length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">
                None yet — load the standard close.
              </li>
            )}
            {(templates.data ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={`w-full px-3 py-2 text-left transition-colors hover:bg-accent ${
                    activeTemplate === t.id ? "bg-accent font-medium" : ""
                  }`}
                >
                  {t.name}
                  <span className="block text-[10px] text-muted-foreground">{t.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="h-8 w-10">#</TableHead>
                <TableHead className="h-8">Name</TableHead>
                <TableHead className="h-8">Task type</TableHead>
                <TableHead className="h-8">Scope</TableHead>
                <TableHead className="h-8">Depends on</TableHead>
                <TableHead className="h-8">Blocking</TableHead>
                <TableHead className="h-8">Approval</TableHead>
                <TableHead className="h-8 w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(steps.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-xs text-muted-foreground">
                    {steps.isLoading ? "Loading…" : "No steps in this template."}
                  </TableCell>
                </TableRow>
              )}
              {(steps.data ?? []).map((step, i) => (
                <TableRow key={step.id} className="text-xs">
                  <TableCell className="tabular-nums">{step.step_no}</TableCell>
                  <TableCell className="font-medium">{step.name}</TableCell>
                  <TableCell>{step.task_type}</TableCell>
                  <TableCell>{step.scope}</TableCell>
                  <TableCell className="tabular-nums">
                    {(step.depends_on_step_no ?? []).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <BoolCell value={step.is_blocking} />
                  </TableCell>
                  <TableCell>
                    <BoolCell value={step.requires_approval} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1"
                        disabled={i === 0 || move.isPending}
                        onClick={() => move.mutate({ step, delta: -1 })}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1"
                        disabled={i === (steps.data ?? []).length - 1 || move.isPending}
                        onClick={() => move.mutate({ step, delta: 1 })}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1"
                        onClick={() => setEditing({ row: step })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1"
                        onClick={() => removeStep.mutate(step.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-sm">{editing?.row ? "Edit step" : "New step"}</SheetTitle>
            <SheetDescription className="text-xs">
              A step becomes runnable once every step it depends on has finished. Entity-scope steps
              wait only on their own entity; group-scope steps wait on all of them.
            </SheetDescription>
          </SheetHeader>
          {editing && activeTemplate && (
            <div className="px-4 pb-6">
              <StepForm
                row={editing.row}
                tenantId={tenantId}
                templateId={activeTemplate}
                existing={steps.data ?? []}
                close={() => {
                  setEditing(null);
                  void queryClient.invalidateQueries({ queryKey: stepsKey });
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function StepForm({
  row,
  tenantId,
  templateId,
  existing,
  close,
}: {
  row: Step | null;
  tenantId: string | null;
  templateId: string;
  existing: Step[];
  close: () => void;
}) {
  const nextNo = useMemo(
    () => (existing.length ? Math.max(...existing.map((s) => s.step_no)) + 1 : 1),
    [existing],
  );

  const [form, setForm] = useState({
    step_no: row?.step_no?.toString() ?? nextNo.toString(),
    name: row?.name ?? "",
    task_type: row?.task_type ?? "BCF",
    scope: row?.scope ?? "ENTITY",
    is_blocking: row?.is_blocking ?? true,
    requires_approval: row?.requires_approval ?? false,
    depends_on: (row?.depends_on_step_no ?? []).map(String),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("A name is required");
      const payload = {
        step_no: Number(form.step_no),
        name: form.name.trim(),
        task_type: form.task_type,
        scope: form.scope,
        is_blocking: form.is_blocking,
        requires_approval: form.requires_approval,
        depends_on_step_no: form.depends_on.length ? form.depends_on.map(Number) : null,
      };
      const { error } = row
        ? await supabase.from("workflow_step").update(payload).eq("id", row.id)
        : await supabase
            .from("workflow_step")
            .insert({ ...payload, tenant_id: tenantId as string, template_id: templateId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(row ? "Step updated" : "Step added");
      close();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Step number">
          <Input
            type="number"
            className="h-8 text-xs"
            value={form.step_no}
            onChange={(e) => setForm({ ...form, step_no: e.target.value })}
          />
        </Field>
        <Field label="Scope">
          <SelectField
            value={form.scope}
            onChange={(v) => setForm({ ...form, scope: v })}
            options={[
              { value: "ENTITY", label: "ENTITY" },
              { value: "GROUP", label: "GROUP" },
            ]}
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
      <Field label="Task type">
        <SelectField
          value={form.task_type}
          onChange={(v) => setForm({ ...form, task_type: v })}
          options={TASK_TYPES.map((t) => ({ value: t, label: t }))}
        />
      </Field>
      <Field label="Depends on steps">
        <MultiSelect
          label="Steps"
          className="w-full"
          options={existing
            .filter((s) => s.id !== row?.id)
            .map((s) => ({ value: String(s.step_no), label: `${s.step_no} — ${s.name}` }))}
          selected={form.depends_on}
          onChange={(v) => setForm({ ...form, depends_on: v })}
        />
      </Field>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.is_blocking}
          onCheckedChange={(v) => setForm({ ...form, is_blocking: Boolean(v) })}
        />
        Blocking — an error here stops everything downstream
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={form.requires_approval}
          onCheckedChange={(v) => setForm({ ...form, requires_approval: Boolean(v) })}
        />
        Requires approval
      </label>

      <div className="flex justify-end gap-2 pt-3">
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

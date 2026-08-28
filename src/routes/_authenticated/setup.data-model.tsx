import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Loader2, Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import {
  activeDimensionsQueryKey,
  selectOptionalDimensions,
  useActiveDimensions,
} from "@/hooks/use-active-dimensions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  DIMENSION_TEMPLATES,
  MANDATORY_DIMENSIONS,
  MAX_OPTIONAL_DIMENSIONS,
  normalizeDimensionCode,
  type DimensionSelection,
} from "@/lib/data-model";

const TITLE = "Data Model | Consolidation";
const DESCRIPTION =
  "Activate the mandatory and optional dimensions that make up the consolidation data model.";

export const Route = createFileRoute("/_authenticated/setup/data-model")({
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
  component: DataModelWizard,
});

const STEPS = [
  { id: "step-1", label: "Mandatory dimensions" },
  { id: "step-2", label: "Optional dimensions" },
  { id: "step-3", label: "Confirm & activate" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function DataModelWizard() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<StepId>("step-1");
  const [selected, setSelected] = useState<DimensionSelection[] | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [customName, setCustomName] = useState("");
  const [activatedAt, setActivatedAt] = useState<string | null>(null);

  const activeDimensions = useActiveDimensions();
  const activeOptional = useMemo(
    () => selectOptionalDimensions(activeDimensions.data ?? []),
    [activeDimensions.data],
  );

  // Seed the selection from what is already active, once loaded.
  const selection: DimensionSelection[] =
    selected ?? activeOptional.map((row) => ({ code: row.dim_code, name: row.dim_name }));

  const memberCounts = useQuery({
    queryKey: ["dim-member-counts", appUser?.tenant_id ?? "anonymous"],
    enabled: Boolean(appUser?.tenant_id) && activeOptional.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_generic_member").select("dim_code");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.dim_code] = (counts[row.dim_code] ?? 0) + 1;
      return counts;
    },
  });

  const activate = useMutation({
    mutationFn: async (dimensions: DimensionSelection[]) => {
      const { data, error } = await supabase.rpc(
        "activate_data_model" as never,
        { p_dimensions: dimensions } as never,
      );
      if (error) throw error;
      return data as { activated_at?: string } | null;
    },
    onSuccess: async (data) => {
      setActivatedAt(data?.activated_at ?? new Date().toISOString());
      await queryClient.invalidateQueries({
        queryKey: activeDimensionsQueryKey(appUser?.tenant_id ?? null),
      });
      await queryClient.invalidateQueries({ queryKey: ["dim-member-counts"] });
      toast.success("Data model activated");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Activation failed");
    },
  });

  const used = selection.length;
  const atLimit = used >= MAX_OPTIONAL_DIMENSIONS;

  function toggleTemplate(code: string, name: string) {
    setSelected(() => {
      const exists = selection.some((s) => s.code === code);
      if (exists) return selection.filter((s) => s.code !== code);
      if (selection.length >= MAX_OPTIONAL_DIMENSIONS) {
        toast.error(`Maximum of ${MAX_OPTIONAL_DIMENSIONS} optional dimensions reached`);
        return selection;
      }
      return [...selection, { code, name }];
    });
  }

  function addCustom() {
    const code = normalizeDimensionCode(customCode);
    if (!code) {
      toast.error("Enter a dimension code");
      return;
    }
    if (selection.some((s) => s.code === code)) {
      toast.error(`${code} is already selected`);
      return;
    }
    if (atLimit) {
      toast.error(`Maximum of ${MAX_OPTIONAL_DIMENSIONS} optional dimensions reached`);
      return;
    }
    setSelected([...selection, { code, name: customName.trim() || code }]);
    setCustomCode("");
    setCustomName("");
  }

  const activatedLabel = activatedAt
    ? new Date(activatedAt).toLocaleString()
    : activeOptional.length > 0
      ? "previously"
      : null;

  return (
    <PageShell
      title="Data Model"
      description={DESCRIPTION}
      actions={
        activeOptional.length > 0 || activatedAt ? (
          <Badge variant="secondary" className="font-normal">
            Model activated on {activatedLabel}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            Not activated
          </Badge>
        )
      }
    >
      <Tabs value={step} onValueChange={(value) => setStep(value as StepId)}>
        <TabsList className="h-auto w-full justify-start gap-1 bg-muted/50 p-1">
          {STEPS.map((s, index) => (
            <TabsTrigger key={s.id} value={s.id} className="gap-2 text-xs">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                  step === s.id ? "border-foreground" : "border-muted-foreground/40",
                )}
              >
                {index + 1}
              </span>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Step 1 — mandatory dimensions */}
        <TabsContent value="step-1" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            These eight dimensions are fixed by the consolidation engine and cannot be deselected.
          </p>
          <div className="rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Dimension</TableHead>
                  <TableHead className="w-[200px]">Physical column</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {MANDATORY_DIMENSIONS.map((dim) => (
                  <TableRow key={dim.code}>
                    <TableCell className="font-medium">{dim.name}</TableCell>
                    <TableCell className="font-mono text-xs">{dim.physicalColumn}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dim.description}
                    </TableCell>
                    <TableCell>
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStep("step-2")}>
              Continue
            </Button>
          </div>
        </TabsContent>

        {/* Step 2 — optional dimensions */}
        <TabsContent value="step-2" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Pick the optional dimensions to activate. Each one is assigned a free generic slot.
            </p>
            <span className="text-xs font-medium tabular-nums">
              {used} of {MAX_OPTIONAL_DIMENSIONS} slots used
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DIMENSION_TEMPLATES.map((template) => {
              const checked = selection.some((s) => s.code === template.code);
              const disabled = !checked && atLimit;
              return (
                <label
                  key={template.code}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded border p-2.5",
                    checked && "border-foreground/40 bg-muted/40",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => toggleTemplate(template.code, template.name)}
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-xs font-medium">{template.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {template.code}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {template.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium">Custom dimension</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="custom-code" className="text-xs">
                  Code
                </Label>
                <Input
                  id="custom-code"
                  value={customCode}
                  onChange={(event) => setCustomCode(event.target.value)}
                  placeholder="E.G. REGION"
                  className="h-8 w-48 font-mono text-xs uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="custom-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="custom-name"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="Region"
                  className="h-8 w-56 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" onClick={addCustom} disabled={atLimit}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>

          {selection.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selection.map((s) => (
                <Badge key={s.code} variant="secondary" className="gap-1 font-normal">
                  <span className="font-mono text-[10px]">{s.code}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${s.code}`}
                    onClick={() => setSelected(selection.filter((item) => item.code !== s.code))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => setStep("step-1")}>
              Back
            </Button>
            <Button size="sm" onClick={() => setStep("step-3")}>
              Continue
            </Button>
          </div>
        </TabsContent>

        {/* Step 3 — confirm & activate */}
        <TabsContent value="step-3" className="mt-4 space-y-4">
          <div className="rounded border p-3">
            <p className="text-xs font-medium">Ready to activate</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {MANDATORY_DIMENSIONS.length} mandatory dimensions plus {selection.length} optional
              dimension{selection.length === 1 ? "" : "s"}. Activation is idempotent: existing slots
              are reused, a default <span className="font-mono">#</span> (Not Assigned) member is
              seeded, and dimensions that already carry fact data are never deactivated.
            </p>
            {selection.length > 0 && (
              <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {selection.map((s) => (
                  <li key={s.code} className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-[10px]">{s.code}</span>
                    <span className="text-muted-foreground">{s.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => setStep("step-2")}>
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => activate.mutate(selection)}
              disabled={activate.isPending}
            >
              {activate.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Confirm & activate
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Active model</p>
            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dimension</TableHead>
                    <TableHead className="w-[160px]">Physical column</TableHead>
                    <TableHead className="w-[200px]">Master table</TableHead>
                    <TableHead className="w-[140px] text-right">Member count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(activeDimensions.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        No dimensions activated yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {(activeDimensions.data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.dim_name}
                        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                          {row.dim_code}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.physical_column}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.master_table ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.physical_column.startsWith("zdim")
                          ? (memberCounts.data?.[row.dim_code] ?? 0)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

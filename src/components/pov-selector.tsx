import { useQuery } from "@tanstack/react-query";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";

const currentYear = new Date().getUTCFullYear();
const years = Array.from({ length: 9 }, (_, i) => currentYear - 5 + i);
const periods = Array.from({ length: 12 }, (_, i) => i + 1);

export function PovSelector() {
  const { pov, setPov } = usePov();
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const versions = useQuery({
    queryKey: ["pov", "versions", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dim_version")
        .select("id, code, name")
        .eq("tenant_id", tenantId!)
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const consGroups = useQuery({
    queryKey: ["pov", "cons-groups", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dim_cons_group")
        .select("id, code, name")
        .eq("tenant_id", tenantId!)
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Field label="Version">
        <Select
          value={pov.versionId ?? ""}
          onValueChange={(v) => setPov({ versionId: v })}
        >
          <SelectTrigger className="h-8 w-[150px] text-sm">
            <SelectValue placeholder="Select version" />
          </SelectTrigger>
          <SelectContent>
            {(versions.data ?? []).map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-sm">
                {v.code} — {v.name}
              </SelectItem>
            ))}
            {(versions.data ?? []).length === 0 && (
              <SelectItem value="__none" disabled className="text-sm">
                No versions
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Year">
        <Select
          value={String(pov.fiscalYear)}
          onValueChange={(v) => setPov({ fiscalYear: Number(v) })}
        >
          <SelectTrigger className="h-8 w-[92px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)} className="text-sm">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Period">
        <Select value={String(pov.period)} onValueChange={(v) => setPov({ period: Number(v) })}>
          <SelectTrigger className="h-8 w-[92px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p} value={String(p)} className="text-sm">
                P{String(p).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Cons. Group">
        <Select value={pov.consGroupId ?? ""} onValueChange={(v) => setPov({ consGroupId: v })}>
          <SelectTrigger className="h-8 w-[170px] text-sm">
            <SelectValue placeholder="Select group" />
          </SelectTrigger>
          <SelectContent>
            {(consGroups.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-sm">
                {g.code} — {g.name}
              </SelectItem>
            ))}
            {(consGroups.data ?? []).length === 0 && (
              <SelectItem value="__none" disabled className="text-sm">
                No groups
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

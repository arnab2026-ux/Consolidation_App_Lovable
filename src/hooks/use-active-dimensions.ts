import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/types/db";

export type DimensionRegistryRow = Tables<"dim_registry">;

export const activeDimensionsQueryKey = (tenantId: string | null | undefined) =>
  ["active-dimensions", tenantId ?? "anonymous"] as const;

/**
 * Single source of truth for which dimension columns exist in the model.
 * Every fact-data screen, upload mapper and report must derive its columns
 * from this list (in `display_order`) instead of hardcoding `zdimNN`.
 */
export function useActiveDimensions(): UseQueryResult<DimensionRegistryRow[]> {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;

  return useQuery({
    queryKey: activeDimensionsQueryKey(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dim_registry")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("dim_code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Optional (zdimNN-backed) dimensions only, in display order. */
export function selectOptionalDimensions(rows: DimensionRegistryRow[]): DimensionRegistryRow[] {
  return rows.filter((row) => row.physical_column.startsWith("zdim"));
}

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** One row of the recursive Postgres view `public.v_hierarchy_flat`. */
export interface HierarchyFlatRow {
  hierarchy_id: string;
  ancestor_code: string;
  descendant_code: string;
  depth: number;
  sign: number;
}

/**
 * Ancestor → descendant closure with the multiplied aggregation sign, read from
 * the recursive view. Reporting screens roll up leaf values with this instead of
 * walking `dim_hierarchy_node` in the client.
 */
export function useHierarchyFlat(hierarchyId: string | null): UseQueryResult<HierarchyFlatRow[]> {
  return useQuery({
    queryKey: ["v_hierarchy_flat", hierarchyId],
    enabled: Boolean(hierarchyId),
    staleTime: 60 * 1000,
    queryFn: async () => {
      // The view is not part of the generated table types; the row shape is pinned above.
      const client = supabase as unknown as {
        from: (relation: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => Promise<{ data: HierarchyFlatRow[] | null; error: Error | null }>;
          };
        };
      };
      const { data, error } = await client
        .from("v_hierarchy_flat")
        .select("hierarchy_id, ancestor_code, descendant_code, depth, sign")
        .eq("hierarchy_id", hierarchyId as string);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Roll leaf-level amounts up to every ancestor node of the hierarchy, applying the
 * closure sign (+1 / −1 / 0) of each descendant relative to the ancestor.
 */
export function rollUp(flat: HierarchyFlatRow[], leafValues: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of flat) {
    const value = leafValues.get(row.descendant_code);
    if (value === undefined || row.sign === 0) continue;
    totals.set(row.ancestor_code, (totals.get(row.ancestor_code) ?? 0) + value * row.sign);
  }
  return totals;
}

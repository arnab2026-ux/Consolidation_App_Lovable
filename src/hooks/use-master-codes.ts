import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface CodeRow {
  id: string;
  code: string;
  name: string | null;
}

export interface MasterCodes {
  entities: CodeRow[];
  accounts: CodeRow[];
  movements: CodeRow[];
  versions: CodeRow[];
  consGroups: CodeRow[];
  /** dim_code → members of that generic dimension */
  genericMembers: Record<string, CodeRow[]>;
}

/** Code/name lists for every dimension, shared by the journal grid and data browser. */
export function useMasterCodes(tenantId: string | null | undefined): UseQueryResult<MasterCodes> {
  return useQuery({
    queryKey: ["master-codes", tenantId],
    enabled: Boolean(tenantId),
    staleTime: 60_000,
    queryFn: async (): Promise<MasterCodes> => {
      const [entities, accounts, movements, versions, groups, generic] = await Promise.all([
        supabase.from("dim_entity").select("id, code, name").order("code"),
        supabase.from("dim_account").select("id, code, name").order("code"),
        supabase.from("dim_movement").select("id, code, name").order("code"),
        supabase.from("dim_version").select("id, code, name").order("code"),
        supabase.from("dim_cons_group").select("id, code, name").order("code"),
        supabase.from("dim_generic_member").select("id, code, name, dim_code").order("code"),
      ]);
      for (const result of [entities, accounts, movements, versions, groups, generic]) {
        if (result.error) throw result.error;
      }
      const genericMembers: Record<string, CodeRow[]> = {};
      for (const row of generic.data ?? []) {
        const bucket = (genericMembers[row.dim_code] ??= []);
        bucket.push({ id: row.id, code: row.code, name: row.name });
      }
      return {
        entities: entities.data ?? [],
        accounts: accounts.data ?? [],
        movements: movements.data ?? [],
        versions: versions.data ?? [],
        consGroups: groups.data ?? [],
        genericMembers,
      };
    },
  });
}

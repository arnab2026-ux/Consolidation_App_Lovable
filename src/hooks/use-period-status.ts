import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Pov } from "@/lib/pov-context";

export type PeriodStatus = "OPEN" | "SUBMITTED" | "LOCKED" | "CLOSED";

export interface PeriodGuard {
  status: PeriodStatus;
  /** LOCKED and CLOSED periods reject staging, posting and reversal. */
  blocked: boolean;
}

/**
 * Status of the POV period. Defaults to OPEN when no `period_status` row exists,
 * matching the database guard `assert_period_open`.
 */
export function usePeriodGuard(pov: Pov): UseQueryResult<PeriodGuard> {
  return useQuery({
    queryKey: ["period-status", pov.versionId, pov.fiscalYear, pov.period, pov.consGroupId],
    enabled: Boolean(pov.versionId),
    queryFn: async () => {
      let query = supabase
        .from("period_status")
        .select("status, cons_group_id")
        .eq("version_id", pov.versionId as string)
        .eq("fiscal_year", pov.fiscalYear)
        .eq("period", pov.period);
      if (pov.consGroupId) query = query.or(`cons_group_id.is.null,cons_group_id.eq.${pov.consGroupId}`);
      else query = query.is("cons_group_id", null);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      const specific = rows.find((row) => row.cons_group_id !== null) ?? rows[0];
      const status = (specific?.status ?? "OPEN") as PeriodStatus;
      return { status, blocked: status === "LOCKED" || status === "CLOSED" };
    },
  });
}

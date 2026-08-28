import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/reports/ic-reconciliation")({
  head: () => ({
    meta: [
      { title: "IC Reconciliation | Consolidation" },
      { name: "description", content: "Matched and unmatched intercompany balances." },
      { property: "og:title", content: "IC Reconciliation | Consolidation" },
      { property: "og:description", content: "Matched and unmatched intercompany balances." },
    ],
  }),
  component: () => <Placeholder title="IC Reconciliation" description="Matched and unmatched intercompany balances." />,
});

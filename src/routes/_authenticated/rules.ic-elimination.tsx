import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/rules/ic-elimination")({
  head: () => ({
    meta: [
      { title: "IC Elimination | Consolidation" },
      { name: "description", content: "Intercompany elimination pairs and thresholds." },
      { property: "og:title", content: "IC Elimination | Consolidation" },
      { property: "og:description", content: "Intercompany elimination pairs and thresholds." },
    ],
  }),
  component: () => <Placeholder title="IC Elimination" description="Intercompany elimination pairs and thresholds." />,
});

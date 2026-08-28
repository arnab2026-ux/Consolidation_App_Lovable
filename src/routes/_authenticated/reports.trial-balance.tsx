import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/reports/trial-balance")({
  head: () => ({
    meta: [
      { title: "Trial Balance | Consolidation" },
      { name: "description", content: "Local and group currency trial balance." },
      { property: "og:title", content: "Trial Balance | Consolidation" },
      { property: "og:description", content: "Local and group currency trial balance." },
    ],
  }),
  component: () => <Placeholder title="Trial Balance" description="Local and group currency trial balance." />,
});

import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/reports/consolidated-statements")({
  head: () => ({
    meta: [
      { title: "Consolidated Statements | Consolidation" },
      { name: "description", content: "Balance sheet and income statement." },
      { property: "og:title", content: "Consolidated Statements | Consolidation" },
      { property: "og:description", content: "Balance sheet and income statement." },
    ],
  }),
  component: () => <Placeholder title="Consolidated Statements" description="Balance sheet and income statement." />,
});

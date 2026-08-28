import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/reports/audit-trail")({
  head: () => ({
    meta: [
      { title: "Audit Trail | Consolidation" },
      { name: "description", content: "Traceability of every posted amount." },
      { property: "og:title", content: "Audit Trail | Consolidation" },
      { property: "og:description", content: "Traceability of every posted amount." },
    ],
  }),
  component: () => <Placeholder title="Audit Trail" description="Traceability of every posted amount." />,
});

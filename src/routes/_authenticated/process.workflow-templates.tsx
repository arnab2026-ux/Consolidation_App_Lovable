import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/process/workflow-templates")({
  head: () => ({
    meta: [
      { title: "Workflow Templates | Consolidation" },
      { name: "description", content: "Define close tasks and dependencies." },
      { property: "og:title", content: "Workflow Templates | Consolidation" },
      { property: "og:description", content: "Define close tasks and dependencies." },
    ],
  }),
  component: () => <Placeholder title="Workflow Templates" description="Define close tasks and dependencies." />,
});

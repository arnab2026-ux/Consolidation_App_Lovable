import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/process/task-log")({
  head: () => ({
    meta: [
      { title: "Task Log | Consolidation" },
      { name: "description", content: "Execution history of workflow tasks." },
      { property: "og:title", content: "Task Log | Consolidation" },
      { property: "og:description", content: "Execution history of workflow tasks." },
    ],
  }),
  component: () => <Placeholder title="Task Log" description="Execution history of workflow tasks." />,
});

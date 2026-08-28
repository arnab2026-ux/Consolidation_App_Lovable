import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/process/monitor")({
  head: () => ({
    meta: [
      { title: "Consolidation Monitor | Consolidation" },
      { name: "description", content: "Track period status per consolidation group." },
      { property: "og:title", content: "Consolidation Monitor | Consolidation" },
      { property: "og:description", content: "Track period status per consolidation group." },
    ],
  }),
  component: () => <Placeholder title="Consolidation Monitor" description="Track period status per consolidation group." />,
});

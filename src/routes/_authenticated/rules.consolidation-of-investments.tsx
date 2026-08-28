import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/rules/consolidation-of-investments")({
  head: () => ({
    meta: [
      { title: "Consolidation of Investments | Consolidation" },
      { name: "description", content: "Purchase accounting and minority interest." },
      { property: "og:title", content: "Consolidation of Investments | Consolidation" },
      { property: "og:description", content: "Purchase accounting and minority interest." },
    ],
  }),
  component: () => <Placeholder title="Consolidation of Investments" description="Purchase accounting and minority interest." />,
});

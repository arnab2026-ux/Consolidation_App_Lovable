import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/rules/net-income")({
  head: () => ({
    meta: [
      { title: "Net Income | Consolidation" },
      { name: "description", content: "Net income transfer to equity rules." },
      { property: "og:title", content: "Net Income | Consolidation" },
      { property: "og:description", content: "Net income transfer to equity rules." },
    ],
  }),
  component: () => <Placeholder title="Net Income" description="Net income transfer to equity rules." />,
});

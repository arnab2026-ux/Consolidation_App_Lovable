import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "@/components/page-shell";

export const Route = createFileRoute("/_authenticated/rules/currency-translation")({
  head: () => ({
    meta: [
      { title: "Currency Translation | Consolidation" },
      { name: "description", content: "Translation method per account and movement." },
      { property: "og:title", content: "Currency Translation | Consolidation" },
      { property: "og:description", content: "Translation method per account and movement." },
    ],
  }),
  component: () => <Placeholder title="Currency Translation" description="Translation method per account and movement." />,
});

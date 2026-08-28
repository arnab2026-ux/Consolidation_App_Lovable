import { createFileRoute } from "@tanstack/react-router";

import { FxRatesTab } from "@/components/dimensions/fx-rates-tab";
import { PageShell } from "@/components/page-shell";

const TITLE = "FX Rates | Consolidation";
const DESCRIPTION = "Closing, average, historical and opening exchange rates per period.";

export const Route = createFileRoute("/_authenticated/setup/fx-rates")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <PageShell title="FX Rates" description={DESCRIPTION}>
      <FxRatesTab />
    </PageShell>
  ),
});

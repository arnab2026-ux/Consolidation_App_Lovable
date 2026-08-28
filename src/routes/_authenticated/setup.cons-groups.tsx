import { createFileRoute } from "@tanstack/react-router";

import { ConsGroupsTab } from "@/components/dimensions/cons-groups-tab";
import { PageShell } from "@/components/page-shell";

const TITLE = "Consolidation Groups | Consolidation";
const DESCRIPTION = "Group structures, entity membership, ownership and consolidation methods.";

export const Route = createFileRoute("/_authenticated/setup/cons-groups")({
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
    <PageShell title="Consolidation Groups" description={DESCRIPTION}>
      <ConsGroupsTab />
    </PageShell>
  ),
});

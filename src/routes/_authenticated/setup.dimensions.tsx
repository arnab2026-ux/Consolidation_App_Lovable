import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AccountTab } from "@/components/dimensions/account-tab";
import { ConsGroupsTab } from "@/components/dimensions/cons-groups-tab";
import { EntityTab } from "@/components/dimensions/entity-tab";
import { FxRatesTab } from "@/components/dimensions/fx-rates-tab";
import { GenericDimensionTab } from "@/components/dimensions/generic-tab";
import { MovementTab } from "@/components/dimensions/movement-tab";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveDimensions } from "@/hooks/use-active-dimensions";

const TITLE = "Dimensions | Consolidation";
const DESCRIPTION = "Maintain master data for every active dimension of the consolidation model.";

export const Route = createFileRoute("/_authenticated/setup/dimensions")({
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
  component: DimensionsPage,
});

function DimensionsPage() {
  const dimensions = useActiveDimensions();
  const [tab, setTab] = useState("entity");

  const customDimensions = useMemo(
    () => (dimensions.data ?? []).filter((dim) => dim.physical_column.startsWith("zdim")),
    [dimensions.data],
  );

  const tabs = useMemo(
    () => [
      { value: "entity", label: "Entity" },
      { value: "account", label: "Account" },
      { value: "movement", label: "Movement Type" },
      ...customDimensions.map((dim) => ({ value: `dim-${dim.dim_code}`, label: dim.dim_name ?? dim.dim_code })),
      { value: "cons-groups", label: "Consolidation Groups" },
      { value: "fx-rates", label: "FX Rates" },
    ],
    [customDimensions],
  );

  return (
    <PageShell title="Dimensions" description={DESCRIPTION}>
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="h-8 flex-wrap">
          {tabs.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="h-6 text-xs">
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="entity">
          <EntityTab />
        </TabsContent>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="movement">
          <MovementTab />
        </TabsContent>
        {customDimensions.map((dim) => (
          <TabsContent key={dim.dim_code} value={`dim-${dim.dim_code}`}>
            <GenericDimensionTab dimCode={dim.dim_code} dimName={dim.dim_name ?? dim.dim_code} />
          </TabsContent>
        ))}
        <TabsContent value="cons-groups">
          <ConsGroupsTab />
        </TabsContent>
        <TabsContent value="fx-rates">
          <FxRatesTab />
        </TabsContent>
      </Tabs>
      {dimensions.isError && (
        <p className="text-xs text-destructive">{(dimensions.error as Error).message}</p>
      )}
    </PageShell>
  );
}

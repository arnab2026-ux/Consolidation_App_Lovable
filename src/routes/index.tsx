import { createFileRoute, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Group Consolidation Workspace" },
      {
        name: "description",
        content:
          "Multi-tenant group consolidation: master data, rules, close workflow and reporting.",
      },
      { property: "og:title", content: "Group Consolidation Workspace" },
      {
        property: "og:description",
        content:
          "Multi-tenant group consolidation: master data, rules, close workflow and reporting.",
      },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/process/monitor" : "/login" });
  },
  component: () => null,
});

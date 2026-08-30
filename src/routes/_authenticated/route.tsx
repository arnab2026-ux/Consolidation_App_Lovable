import { useEffect } from "react";
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { PovSelector } from "@/components/pov-selector";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { findNavItem } from "@/lib/navigation";
import { PovProvider } from "@/lib/pov-context";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = findNavItem(pathname);
  const { appUser, loading } = useAuth();
  const navigate = useNavigate();

  // An account created with an administrator-chosen password reaches nothing
  // else until it has been replaced. The check lives here rather than in
  // beforeLoad because the profile is loaded client-side after the session is.
  const mustChange = !loading && appUser?.must_change_password === true;
  const onChangePassword = pathname === "/change-password";

  useEffect(() => {
    if (mustChange && !onChangePassword) {
      void navigate({ to: "/change-password", replace: true });
    }
  }, [mustChange, onChangePassword, navigate]);

  // A deactivated account keeps a valid session until it expires, so it is
  // turned away here too.
  const deactivated = !loading && appUser?.is_active === false;
  useEffect(() => {
    if (deactivated) {
      void supabase.auth.signOut();
    }
  }, [deactivated]);

  return (
    <PovProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background px-3 py-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-5" />
            <Breadcrumb>
              <BreadcrumbList className="text-xs">
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-muted-foreground">
                    {match?.group.label ?? "Home"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-medium">
                    {match?.item.title ?? "Overview"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto">
              <PovSelector />
            </div>
          </header>
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PovProvider>
  );
}

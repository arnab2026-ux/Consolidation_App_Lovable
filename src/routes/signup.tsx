import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AuthCard } from "@/routes/login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create workspace | Consolidation" },
      {
        name: "description",
        content: "Create a consolidation tenant or activate an invited account.",
      },
      { property: "og:title", content: "Create workspace | Consolidation" },
      {
        property: "og:description",
        content: "Create a consolidation tenant or activate an invited account.",
      },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      const user = data.user;
      if (!user) {
        toast.success("Check your inbox to confirm your email, then sign in.");
        return;
      }

      // The workspace is created by a SECURITY DEFINER function: the client no
      // longer has write access to tenant or app_user, because holding it let
      // any user move themselves into another tenant.
      const { error: bootstrapError } = await supabase.rpc("bootstrap_workspace", {
        p_tenant_name: tenantName || email,
      });
      if (bootstrapError) throw bootstrapError;
      toast.success("Workspace created");

      if (data.session) {
        void navigate({ to: "/process/monitor" });
      } else {
        void navigate({ to: "/login" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create workspace"
      footer={
        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-foreground underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tenant" className="text-xs">
            Group / company name
          </Label>
          <Input
            id="tenant"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            placeholder="Leave blank if you were invited"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <Button type="submit" size="sm" className="w-full" disabled={busy || !isSupabaseConfigured}>
          {busy ? "Creating…" : "Create account"}
        </Button>
        {!isSupabaseConfigured && (
          <p className="text-xs text-destructive">
            Supabase credentials are not configured for this project yet.
          </p>
        )}
      </form>
    </AuthCard>
  );
}

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

      // Invited users already have an app_user row created by their admin —
      // they inherit that tenant instead of creating a new one.
      const { data: invited } = await supabase
        .from("app_user")
        .select("id, tenant_id, role")
        .eq("email", email)
        .maybeSingle();

      if (invited) {
        if (invited.id !== user.id) {
          await supabase.from("app_user").update({ id: user.id }).eq("id", invited.id);
        }
        toast.success("Account activated");
      } else {
        const { data: tenant, error: tenantError } = await supabase
          .from("tenant")
          .insert({ name: tenantName || email })
          .select("id")
          .single();
        if (tenantError) throw tenantError;

        const { error: userError } = await supabase.from("app_user").insert({
          id: user.id,
          tenant_id: tenant.id,
          email,
          role: "admin",
        });
        if (userError) throw userError;
        toast.success("Workspace created");
      }

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

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | Consolidation" },
      { name: "description", content: "Sign in to the group consolidation workspace." },
      { property: "og:title", content: "Sign in | Consolidation" },
      { property: "og:description", content: "Sign in to the group consolidation workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    void navigate({ to: "/process/monitor" });
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <p className="text-xs text-muted-foreground">
          No workspace yet?{" "}
          <Link to="/signup" className="font-medium text-foreground underline">
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <Button type="submit" size="sm" className="w-full" disabled={busy || !isSupabaseConfigured}>
          {busy ? "Signing in…" : "Sign in"}
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

export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded border bg-background p-5">
        <h1 className="text-sm font-semibold tracking-tight">Group Consolidation</h1>
        <p className="mt-0.5 mb-4 text-xs text-muted-foreground">{title}</p>
        {children}
        {footer && <div className="mt-4 border-t pt-3">{footer}</div>}
      </div>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const TITLE = "Change password | Consolidation";
const DESCRIPTION = "Replace the password you were given with one only you know.";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { appUser, refreshAppUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const required = appUser?.must_change_password ?? false;

  const save = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error("Use at least 8 characters");
      if (password !== confirm) throw new Error("The two passwords do not match");

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Only clear the flag once the password has actually changed, so a failed
      // update cannot let someone past the gate still holding the issued one.
      const { error: rpcError } = await supabase.rpc("complete_password_change");
      if (rpcError) throw rpcError;

      await refreshAppUser();
    },
    onSuccess: () => {
      toast.success("Password changed");
      void navigate({ to: "/process/monitor" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <PageShell title="Change password" description={DESCRIPTION}>
      <div className="max-w-md">
        {required && (
          <p className="mb-3 rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Your account was created with a password an administrator chose, so they know it. Set
            your own before going any further — nothing else is reachable until you do.
          </p>
        )}

        <div className="flex flex-col gap-3 rounded border p-4">
          <Field label="New password" hint="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 text-xs"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              autoComplete="new-password"
              className="h-8 text-xs"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            {!required && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void navigate({ to: "/process/monitor" })}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              className="h-8"
              disabled={save.isPending || password.length < 8 || password !== confirm}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Change password"}
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

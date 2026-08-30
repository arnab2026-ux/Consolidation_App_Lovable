import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { BoolCell, Field, SelectField } from "@/components/field";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

interface WorkspaceUser {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  invited_by_email: string | null;
  is_self: boolean;
}

const ROLES = [
  { value: "admin", label: "Admin — full access, can manage users" },
  { value: "preparer", label: "Preparer — enters and runs data" },
  { value: "reviewer", label: "Reviewer — reviews and approves" },
  { value: "viewer", label: "Viewer — read only" },
];

const TITLE = "Users | Consolidation";
const DESCRIPTION = "People with access to this workspace, and what they may do.";

export const Route = createFileRoute("/_authenticated/setup/users")({
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
  component: UsersPage,
});

function UsersPage() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const isAdmin = appUser?.role === "admin";
  const key = ["admin_list_users", appUser?.tenant_id] as const;

  const users = useQuery({
    queryKey: key,
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []) as WorkspaceUser[];
    },
  });

  const update = useMutation({
    mutationFn: async (args: { id: string; role?: string; isActive?: boolean }) => {
      const { error } = await supabase.rpc("admin_update_user", {
        p_user: args.id,
        ...(args.role !== undefined ? { p_role: args.role } : {}),
        ...(args.isActive !== undefined ? { p_is_active: args.isActive } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User updated");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const forceReset = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_force_password_change", { p_user: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("They will be asked to set a new password at their next sign-in");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) {
    return (
      <PageShell title="Users" description={DESCRIPTION}>
        <div className="flex items-start gap-2 rounded border border-dashed p-6 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Only an administrator can manage the people in this workspace. Ask one of them if you
            need access changed.
          </span>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Users"
      description={DESCRIPTION}
      actions={
        <Button size="sm" className="h-8" onClick={() => setAdding(true)}>
          <Plus className="mr-1 size-3.5" /> New user
        </Button>
      }
    >
      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8">Email</TableHead>
              <TableHead className="h-8 w-44">Role</TableHead>
              <TableHead className="h-8">Active</TableHead>
              <TableHead className="h-8">Must change password</TableHead>
              <TableHead className="h-8">Added by</TableHead>
              <TableHead className="h-8 w-56" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-xs text-muted-foreground">
                  {users.isLoading ? "Loading…" : "No users yet."}
                </TableCell>
              </TableRow>
            )}
            {(users.data ?? []).map((u) => (
              <TableRow key={u.id} className="text-xs">
                <TableCell className="font-medium">
                  {u.email}
                  {u.is_self && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">you</span>
                  )}
                </TableCell>
                <TableCell>
                  <SelectField
                    value={u.role}
                    onChange={(role) => update.mutate({ id: u.id, role })}
                    options={ROLES.map((r) => ({ value: r.value, label: r.value }))}
                  />
                </TableCell>
                <TableCell>
                  <BoolCell value={u.is_active} />
                </TableCell>
                <TableCell>
                  {u.must_change_password ? (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                      pending
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.invited_by_email ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={forceReset.isPending || u.must_change_password}
                      onClick={() => forceReset.mutate(u.id)}
                    >
                      <KeyRound className="mr-1 size-3.5" /> Force reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={update.isPending || u.is_self}
                      onClick={() => update.mutate({ id: u.id, isActive: !u.is_active })}
                    >
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        A new user signs in with the initial password you set and is required to replace it before
        they can reach anything else. Send them the password over a channel you trust — it is shown
        to you once, here, and is not stored anywhere you can read it back.
      </p>

      <NewUserSheet
        open={adding}
        onClose={() => {
          setAdding(false);
          void queryClient.invalidateQueries({ queryKey: key });
        }}
      />
    </PageShell>
  );
}

function NewUserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ email: "", password: "", role: "preparer" });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { email: form.email.trim(), password: form.password, role: form.role },
      });
      // A non-2xx from the function arrives as an error whose body carries the
      // reason; surfacing that is far more useful than "Edge Function returned
      // a non-2xx status code".
      if (error) {
        let message = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) message = parsed.error;
          } catch {
            /* keep the original message */
          }
        }
        throw new Error(message);
      }
      return data as { email: string };
    },
    onSuccess: () => {
      setCreated({ email: form.email.trim(), password: form.password });
      toast.success("User created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const close = () => {
    setForm({ email: "", password: "", role: "preparer" });
    setCreated(null);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-sm">New user</SheetTitle>
          <SheetDescription className="text-xs">
            They join this workspace and sign in with the password you set here, then have to
            replace it immediately.
          </SheetDescription>
        </SheetHeader>

        {created ? (
          <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
            <div className="rounded border bg-muted/30 p-3 text-xs">
              <p className="font-medium">Account created</p>
              <dl className="mt-2 flex flex-col gap-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-mono">{created.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Initial password</dt>
                  <dd className="font-mono">{created.password}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] text-muted-foreground">
                This is the only time the password is shown. Pass it on over something you trust —
                not email, if you can avoid it. If it goes astray, use <em>Force reset</em> and set
                a new one.
              </p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="h-8" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="off"
                className="h-8 text-xs"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field
              label="Initial password"
              hint="At least 8 characters. They will be required to change it at first sign-in."
            >
              <Input
                type="text"
                autoComplete="off"
                className="h-8 font-mono text-xs"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <SelectField
                value={form.role}
                onChange={(role) => setForm({ ...form, role })}
                options={ROLES}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" size="sm" className="h-8" onClick={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                disabled={create.isPending || !form.email || form.password.length < 8}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create user"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

export interface AppUser {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  refreshAppUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadAppUser(user: User): Promise<AppUser | null> {
  const { data } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, role")
    .or(`id.eq.${user.id},email.eq.${user.email ?? ""}`)
    .limit(1)
    .maybeSingle();
  return (data as AppUser | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const hydrate = async (next: Session | null) => {
      if (!active) return;
      setSession(next);
      if (next?.user) {
        const profile = await loadAppUser(next.user);
        if (active) setAppUser(profile);
      } else {
        setAppUser(null);
      }
      if (active) setLoading(false);
    };

    void supabase.auth.getSession().then(({ data }) => hydrate(data.session ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void hydrate(next ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      appUser,
      loading,
      refreshAppUser: async () => {
        if (session?.user) setAppUser(await loadAppUser(session.user));
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setSession(null);
        setAppUser(null);
      },
    }),
    [session, appUser, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

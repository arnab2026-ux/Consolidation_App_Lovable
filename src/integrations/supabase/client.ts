import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

// Publishable (browser-safe) credentials for the external Supabase project.
const DEFAULT_URL = "https://dcwrltyqzkgzcnhjxrej.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_Utyl97nHnM06s-nTCGIujw_eLjW8a4K";

const url = import.meta.env["VITE_SUPABASE_URL"] ?? DEFAULT_URL;
const publishableKey =
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  import.meta.env["VITE_SUPABASE_ANON_KEY"] ??
  DEFAULT_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * Browser Supabase client. Safe for components, hooks and event handlers.
 * When env vars are missing the client is still constructed with placeholders
 * so the app renders instead of crashing at import time.
 */
export const supabase = createClient<Database>(
  url || "https://placeholder.supabase.co",
  publishableKey || "placeholder-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

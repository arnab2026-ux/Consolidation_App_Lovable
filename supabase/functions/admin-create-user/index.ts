// Creates a user in this administrator's workspace with an initial password.
//
// Creating an auth user needs the service role key, which must never reach the
// browser. Supabase injects it into Edge Functions automatically, so it lives
// here and nowhere else - not in Vercel's environment, not in the bundle.
//
// The caller's own JWT decides what they may do: the function reads their
// app_user row with the service role, requires role = 'admin', and takes the
// tenant from that row rather than from the request body. An administrator can
// therefore only ever create users inside their own workspace.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["admin", "preparer", "reviewer", "viewer"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Not signed in" }, 401);

  // Who is asking. Uses the anon key plus their token, so the token is verified
  // rather than trusted.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerError,
  } = await asCaller.auth.getUser();
  if (callerError || !caller) return json({ error: "Not signed in" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: me } = await admin
    .from("app_user")
    .select("tenant_id, role, is_active")
    .eq("id", caller.id)
    .maybeSingle();

  if (!me || me.role !== "admin" || me.is_active === false) {
    return json({ error: "Only an active administrator can create users" }, 403);
  }

  let body: { email?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role ?? "preparer";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
  if (password.length < 8) {
    return json({ error: "The initial password must be at least 8 characters" }, 400);
  }
  if (!ROLES.includes(role)) return json({ error: `Unknown role ${role}` }, 400);

  const { data: clash } = await admin
    .from("app_user")
    .select("id, tenant_id")
    .ilike("email", email)
    .maybeSingle();
  if (clash) {
    return json(
      {
        error:
          clash.tenant_id === me.tenant_id
            ? "That email already has an account in this workspace"
            : "That email already belongs to another workspace",
      },
      409,
    );
  }

  // email_confirm skips the confirmation mail: the administrator is handing the
  // password over directly, so there is nothing to confirm.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return json({ error: createError?.message ?? "Could not create the account" }, 400);
  }

  const { error: profileError } = await admin.from("app_user").insert({
    id: created.user.id,
    tenant_id: me.tenant_id,
    email,
    role,
    must_change_password: true,
    invited_by: caller.id,
  });

  if (profileError) {
    // Do not leave an auth account with no workspace behind it: the user could
    // sign in and land nowhere.
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ id: created.user.id, email, role, must_change_password: true }, 201);
});

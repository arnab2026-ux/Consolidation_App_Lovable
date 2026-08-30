-- User administration, and closing two holes in how app_user was protected.
--
-- SECURITY. `authenticated` held INSERT/UPDATE/DELETE on app_user and tenant,
-- and the only policy was
--
--     create policy own_user on app_user for all using (id = auth.uid())
--
-- with no WITH CHECK. For an UPDATE, Postgres falls back to USING for the check,
-- so the row is re-checked as "is this still my own id" - which it is. Any
-- signed-up user could therefore run
--
--     update app_user set tenant_id = '<someone else's tenant>' where id = auth.uid();
--
-- and current_tenant_id() would hand them that tenant, which every RLS policy in
-- the schema trusts. That is full cross-tenant read and write. The same route
-- allowed setting role = 'admin'.
--
-- The fix is not a better policy: it is to stop the client writing these tables
-- at all. Every mutation now goes through a SECURITY DEFINER function that
-- decides what the caller may change, and app_user keeps only SELECT.
--
-- FIRST LOGIN. A user created by an admin gets must_change_password, and the
-- application routes them to the change-password screen until it is cleared.
-- The flag is cleared by complete_password_change(), which the client can only
-- call for itself.

alter table public.app_user
  add column if not exists must_change_password boolean not null default false;
alter table public.app_user
  add column if not exists is_active boolean not null default true;
alter table public.app_user
  add column if not exists invited_by uuid references public.app_user(id);

comment on column public.app_user.must_change_password is
  'Set when an administrator creates the account with an initial password. '
  'The application blocks every other screen until the user has replaced it.';

-- ------------------------------------------------------------------ helpers
-- SECURITY DEFINER so the policy on app_user can ask "is the caller an admin"
-- without reading app_user under that same policy and recursing.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select role from app_user where id = auth.uid();
$function$;

-- ------------------------------------------------------------------- grants
-- Reads stay under RLS; every write goes through a function below.
revoke insert, update, delete, truncate on public.app_user from anon, authenticated;
revoke insert, update, delete, truncate on public.tenant   from anon, authenticated;

drop policy if exists own_user on public.app_user;
drop policy if exists app_user_read on public.app_user;
create policy app_user_read on public.app_user
  for select
  using (
    id = auth.uid()
    or (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  );

-- The signup insert policy is redundant now that the grant is gone, and it
-- allowed anyone to create tenant rows.
drop policy if exists tenant_signup_insert on public.tenant;

-- ------------------------------------------------------------- new workspace
-- Replaces the client-side tenant + app_user insert that signup used to do.
create or replace function public.bootstrap_workspace(p_tenant_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_tenant uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  if exists (select 1 from app_user u where u.id = v_uid) then
    raise exception 'This account already belongs to a workspace';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then raise exception 'No email on the signed-in account'; end if;

  -- An account an administrator created already has its row; it must not be
  -- able to break out into a workspace of its own.
  if exists (select 1 from app_user u where lower(u.email) = lower(v_email)) then
    raise exception 'An account already exists for %; ask an administrator to reset it', v_email;
  end if;

  insert into tenant (name) values (coalesce(nullif(trim(p_tenant_name), ''), v_email))
  returning id into v_tenant;

  insert into app_user (id, tenant_id, email, role, must_change_password)
  values (v_uid, v_tenant, v_email, 'admin', false);

  return jsonb_build_object('tenant_id', v_tenant, 'role', 'admin');
end
$function$;

-- ------------------------------------------------------------ administration
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, role text, is_active boolean,
  must_change_password boolean, created_at timestamptz, invited_by_email text, is_self boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.id, u.email, u.role, u.is_active, u.must_change_password, u.created_at,
         inv.email, u.id = auth.uid()
    from app_user u
    left join app_user inv on inv.id = u.invited_by
   where u.tenant_id = current_tenant_id()
     and current_user_role() = 'admin'
   order by u.email;
$function$;

create or replace function public.admin_update_user(
  p_user uuid, p_role text default null, p_is_active boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_target app_user;
  v_admins int;
begin
  if current_user_role() <> 'admin' then raise exception 'Only an administrator can do this'; end if;

  select * into v_target from app_user where id = p_user and tenant_id = v_tenant;
  if not found then raise exception 'User not found in this workspace'; end if;

  if p_role is not null and p_role not in ('admin', 'preparer', 'reviewer', 'viewer') then
    raise exception 'Unknown role %', p_role;
  end if;

  -- Losing the last administrator would leave the workspace unmanageable, and
  -- there is no way back from inside the application.
  if v_target.role = 'admin'
     and (coalesce(p_role, 'admin') <> 'admin' or p_is_active is false) then
    select count(*) into v_admins
      from app_user where tenant_id = v_tenant and role = 'admin' and is_active;
    if v_admins <= 1 then
      raise exception 'This is the last active administrator';
    end if;
  end if;

  if p_user = auth.uid() and p_is_active is false then
    raise exception 'You cannot deactivate your own account';
  end if;

  update app_user
     set role = coalesce(p_role, role),
         is_active = coalesce(p_is_active, is_active)
   where id = p_user and tenant_id = v_tenant;

  return jsonb_build_object('id', p_user);
end
$function$;

-- Makes the user replace their password at their next sign-in. Used after an
-- administrator has handed out a new one out of band.
create or replace function public.admin_force_password_change(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_user_role() <> 'admin' then raise exception 'Only an administrator can do this'; end if;

  update app_user set must_change_password = true
   where id = p_user and tenant_id = current_tenant_id();
  if not found then raise exception 'User not found in this workspace'; end if;

  return jsonb_build_object('id', p_user);
end
$function$;

-- Called by the client after supabase.auth.updateUser has actually changed the
-- password. It can only ever clear the flag on the caller's own row.
create or replace function public.complete_password_change()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update app_user set must_change_password = false where id = auth.uid();
  return jsonb_build_object('id', auth.uid());
end
$function$;

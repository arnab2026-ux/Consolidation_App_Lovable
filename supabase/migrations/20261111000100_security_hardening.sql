-- Security hardening.
--
-- Six holes, all reachable with nothing but the publishable key and (for most)
-- a signed-in account:
--
--  1. WORKERS TRUST THE CALLER'S TENANT. run_bcf_entity, run_coi_entity and the
--     other engine workers are SECURITY DEFINER, take p_tenant as an argument and
--     never compare it with current_tenant_id(). Nothing revoked EXECUTE, so
--     PostgREST exposed every one of them as /rpc/<name>: knowing a tenant id was
--     enough to delete and post in that tenant.
--
--  2. seed_demo_dataset(p_tenant, p_reset) wipes whichever tenant it is handed.
--     The administrator check lived only in the React screen.
--
--  3. ROLES WERE DECORATIVE. preparer / reviewer / viewer were enforced nowhere
--     in the database; every table carries one tenant_isolation policy FOR ALL.
--     A viewer could run engines, edit rules and write balances.
--
--  4. THE PERIOD LOCK WAS ADVISORY. Any user could update period_status back to
--     OPEN, or delete fact_balances rows directly (the slice guard covers insert
--     and update, not delete).
--
--  5. A DEACTIVATED ACCOUNT KEPT WORKING until its session expired, and
--     must_change_password was only a client-side redirect: current_tenant_id()
--     looked at neither flag.
--
--  6. post_manual_journal took created_by from the request body, so the audit
--     trail recorded whoever the caller claimed to be.
--
-- WHAT THIS DOES
--
--  * current_tenant_id() / current_user_role() return NULL for an inactive
--    account or one that still owes a password change. Every RLS policy and every
--    wrapper already treats a NULL tenant as "no access", so both flags are now
--    enforced by the database. complete_password_change() and the user's own
--    app_user row do not depend on the tenant, so the change-password screen
--    still works.
--
--  * Write access needs role admin, preparer or reviewer. viewer is
--    read-only. This is enforced by one statement-level trigger on every
--    tenant-scoped table rather than by editing fifteen engine functions: every
--    engine, posting and reversal writes task_run / journal_header /
--    fact_balances, so it is stopped at its first write. auth.uid() is still the
--    end user inside a SECURITY DEFINER function, which is what makes this work.
--    Scripts and the service role have no auth.uid() and are not affected.
--
--  * The client loses direct INSERT/UPDATE/DELETE on the posting tables
--    (fact_balances, journal_header, task_run, workflow_run, ic_reconciliation,
--    period_status). The application never wrote them directly - it only reads
--    them and calls RPCs - so nothing in the UI changes. Because that removes
--    the only (accidental) way to reopen a period, admin_set_period_status() is
--    added for administrators.
--
--  * Engine workers and internal helpers are no longer callable through the
--    API. anon can call nothing except the three identity helpers RLS needs.
--
--  * seed_demo_dataset(uuid, boolean) is renamed seed_demo_dataset_impl and
--    hidden; the callable seed_demo_dataset(p_reset) takes no tenant, requires an
--    administrator and seeds the caller's own workspace.
--
-- AFTER APPLYING
--
--   npm run db:types && npm run db:check && npm run db:smoke && npm run typecheck
--
-- RULES THIS CREATES FOR LATER MIGRATIONS
--
--  * Postgres grants EXECUTE on every new function to PUBLIC, which includes
--    anon. So a migration that creates a function must end with
--        revoke execute on function <name>(<args>) from public, anon;
--    and, for a worker that takes p_tenant or is only called by other
--    functions, also "from authenticated".
--  * A new tenant-scoped table needs the require_write_role trigger as well as
--    its tenant_isolation policy (copy the create trigger statement below).
--  * Change the demo seed by replacing seed_demo_dataset_impl(uuid, boolean).
--    Re-creating seed_demo_dataset(uuid, boolean) would reopen hole 2 and give
--    PostgREST two overloads to choose between.
--  * From SQL (no signed-in user) seed with
--        select seed_demo_dataset_impl('<tenant uuid>', true);

-- ============================================================ identity helpers

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.tenant_id
    from app_user u
   where u.id = auth.uid()
     and u.is_active
     and not u.must_change_password;
$function$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.role
    from app_user u
   where u.id = auth.uid()
     and u.is_active
     and not u.must_change_password;
$function$;

-- NULL role (no profile, inactive, password change pending) is not a writer.
create or replace function public.current_user_can_write()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(public.current_user_role() in ('admin', 'preparer', 'reviewer'), false);
$function$;

-- =========================================================== write-role guard
-- Statement level, so the cost is one lookup per statement, not per row.
create or replace function public.require_write_role()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- No end user: a migration, a script, or the service role.
  if auth.uid() is null then
    return null;
  end if;

  if not public.current_user_can_write() then
    raise exception 'Your account is read-only (role: %)',
      coalesce(public.current_user_role(), 'inactive or password change pending')
      using errcode = '42501';
  end if;

  return null;
end
$function$;

do $do$
declare
  t record;
begin
  for t in
    select distinct c.oid::regclass as rel
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and p.polname = 'tenant_isolation'
       and c.relkind in ('r', 'p')
  loop
    execute format('drop trigger if exists require_write_role on %s', t.rel);
    execute format(
      'create trigger require_write_role
         before insert or update or delete on %s
         for each statement execute function public.require_write_role()', t.rel);
  end loop;
end
$do$;

-- ====================================================== resolve_account_filter
-- The rule screens call this directly to preview which accounts a filter
-- selects, so it stays callable - but only for the caller's own workspace.
-- Body otherwise unchanged from the baseline.
create or replace function public.resolve_account_filter(p_tenant uuid, p_filter jsonb)
returns table(account_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_op text := upper(coalesce(p_filter->>'op', 'AND'));
  v_conds jsonb := coalesce(p_filter->'conditions', '[]'::jsonb);
begin
  if auth.uid() is not null and p_tenant is distinct from current_tenant_id() then
    raise exception 'Not your workspace' using errcode = '42501';
  end if;

  if jsonb_typeof(v_conds) <> 'array' or jsonb_array_length(v_conds) = 0 then
    return query
      select a.id from dim_account a
       where a.tenant_id = p_tenant and coalesce(a.is_active, true);
    return;
  end if;

  return query
    select a.id
      from dim_account a
     where a.tenant_id = p_tenant
       and coalesce(a.is_active, true)
       and case
             when v_op = 'OR' then exists (
               select 1 from jsonb_array_elements(v_conds) c
                where match_account_condition(a, c.value))
             else not exists (
               select 1 from jsonb_array_elements(v_conds) c
                where not match_account_condition(a, c.value))
           end;
end
$function$;

-- ========================================================= post_manual_journal
-- Same as 20260829000800 with two changes: v_user is the signed-in user, not
-- whatever the request body says (p_header.created_by is ignored), and the
-- consolidation group lookup is restricted to the caller's workspace.
create or replace function public.post_manual_journal(p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_level char(2) := coalesce(p_header->>'posting_level', '01');
  v_version uuid := (p_header->>'version_id')::uuid;
  v_year int := (p_header->>'fiscal_year')::int;
  v_period int := (p_header->>'period')::int;
  v_group uuid := nullif(p_header->>'cons_group_id', '')::uuid;
  v_user uuid := auth.uid();
  v_doc_type text := coalesce(p_header->>'doc_type', 'MANUAL');
  v_journal uuid; v_doc bigint; v_task uuid; v_rows int; v_sum numeric;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;
  if v_version is null or v_year is null or v_period is null then
    raise exception 'Version, fiscal year and period are required';
  end if;
  if v_level not in ('01','30') then
    raise exception 'Manual journals must be posted at level 01 or 30';
  end if;
  if v_level = '01' and v_group is not null then
    raise exception 'Posting level 01 must not carry a consolidation group';
  end if;
  if v_level = '30' and v_group is null then
    raise exception 'Posting level 30 requires a consolidation group';
  end if;

  perform assert_period_open(v_tenant, v_version, v_year, v_period, v_group);

  select round(sum(coalesce((l->>'amount_lc')::numeric, 0)), 2)
    into v_sum from jsonb_array_elements(p_lines) l;
  if coalesce(v_sum, 0) <> 0 then
    raise exception 'Journal is not balanced: debits minus credits = %', v_sum;
  end if;

  insert into task_run(tenant_id, task_type, cons_group_id, version_id, fiscal_year, period,
                       status, started_at, run_by)
  values (v_tenant, 'MANUAL_JOURNAL', v_group, v_version, v_year, v_period, 'RUNNING', now(), v_user)
  returning id into v_task;

  insert into journal_header(tenant_id, doc_type, posting_level, fiscal_year, period, version_id,
                            cons_group_id, task_run_id, description, created_by)
  values (v_tenant, v_doc_type, v_level, v_year, v_period, v_version, v_group, v_task,
          nullif(p_header->>'description',''), v_user)
  returning id, doc_number into v_journal, v_doc;

  insert into fact_balances(tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id,
    version_id, fiscal_year, period, posting_level,
    zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency, amount_tc, amount_lc, amount_gc,
    journal_id, task_run_id, source_task)
  select v_tenant, e.id, a.id, m.id, p.id,
         case when v_level = '30' then v_group else null end,
         v_version, v_year, v_period, v_level,
         nullif(l->>'zdim01',''), nullif(l->>'zdim02',''), nullif(l->>'zdim03',''),
         nullif(l->>'zdim04',''), nullif(l->>'zdim05',''), nullif(l->>'zdim06',''),
         nullif(l->>'zdim07',''), nullif(l->>'zdim08',''), nullif(l->>'zdim09',''),
         nullif(l->>'zdim10',''),
         coalesce(nullif(l->>'transaction_currency',''), e.local_currency),
         e.local_currency,
         coalesce(g.group_currency, e.local_currency),
         coalesce((l->>'amount_tc')::numeric, (l->>'amount_lc')::numeric, 0),
         coalesce((l->>'amount_lc')::numeric, 0),
         0,
         v_journal, v_task, 'MANUAL'
    from jsonb_array_elements(p_lines) l
    join dim_entity e on e.tenant_id = v_tenant and e.code = l->>'entity_code'
    join dim_account a on a.tenant_id = v_tenant and a.code = l->>'account_code'
    left join dim_movement m on m.tenant_id = v_tenant and m.code = nullif(l->>'movement_code','')
    left join dim_entity p on p.tenant_id = v_tenant and p.code = nullif(l->>'partner_code','')
    left join dim_cons_group g on g.id = v_group and g.tenant_id = v_tenant;

  get diagnostics v_rows = row_count;
  if v_rows <> jsonb_array_length(p_lines) then
    raise exception 'Some lines reference unknown entity or account codes (% of % resolved)',
      v_rows, jsonb_array_length(p_lines);
  end if;

  update task_run set status = 'SUCCESS', rows_written = v_rows, journal_id = v_journal,
                      finished_at = now()
   where id = v_task;

  return jsonb_build_object('journal_id', v_journal, 'doc_number', v_doc,
                            'task_run_id', v_task, 'rows_posted', v_rows);
end
$function$;

-- ================================================================== demo seed
-- Hide the tenant-taking implementation behind an admin-only entry point.
do $do$
begin
  if to_regprocedure('public.seed_demo_dataset(uuid, boolean)') is not null then
    if to_regprocedure('public.seed_demo_dataset_impl(uuid, boolean)') is not null then
      -- A previous run of this migration already renamed one; the function
      -- found now is a stale re-creation and must not stay callable.
      drop function public.seed_demo_dataset_impl(uuid, boolean);
    end if;
    alter function public.seed_demo_dataset(uuid, boolean) rename to seed_demo_dataset_impl;
  end if;
end
$do$;

create or replace function public.seed_demo_dataset(p_reset boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'No workspace for the current user';
  end if;
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only an administrator can load the demo dataset' using errcode = '42501';
  end if;

  return seed_demo_dataset_impl(v_tenant, p_reset);
end
$function$;

-- ============================================================== period status
-- Direct writes to period_status are revoked below, so reopening or closing a
-- period needs a deliberate, administrator-only entry point.
create or replace function public.admin_set_period_status(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_status text,
  p_cons_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_rows int;
begin
  if v_tenant is null then raise exception 'No workspace for the current user'; end if;
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only an administrator can change a period''s status' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('OPEN', 'SUBMITTED', 'LOCKED', 'CLOSED') then
    raise exception 'Unknown period status %', p_status;
  end if;
  if not exists (select 1 from dim_version v where v.id = p_version and v.tenant_id = v_tenant) then
    raise exception 'Version not found in this workspace';
  end if;
  if p_cons_group is not null and not exists (
       select 1 from dim_cons_group g where g.id = p_cons_group and g.tenant_id = v_tenant) then
    raise exception 'Consolidation group not found in this workspace';
  end if;

  update period_status
     set status = p_status
   where tenant_id = v_tenant and version_id = p_version
     and fiscal_year = p_year and period = p_period
     and cons_group_id is not distinct from p_cons_group;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into period_status (tenant_id, fiscal_year, period, version_id, cons_group_id, status)
    values (v_tenant, p_year, p_period, p_version, p_cons_group, p_status);
  end if;

  return jsonb_build_object('fiscal_year', p_year, 'period', p_period, 'status', p_status);
end
$function$;

-- The two existing admin functions tested `current_user_role() <> 'admin'`.
-- With a NULL role that is NULL, so the IF did not fire; they were saved only by
-- the tenant lookup that follows. IS DISTINCT FROM makes the check mean what it
-- says. Bodies otherwise unchanged from 20260831000200.
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
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only an administrator can do this';
  end if;

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

create or replace function public.admin_force_password_change(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only an administrator can do this';
  end if;

  update app_user set must_change_password = true
   where id = p_user and tenant_id = current_tenant_id();
  if not found then raise exception 'User not found in this workspace'; end if;

  return jsonb_build_object('id', p_user);
end
$function$;

-- ================================================================= privileges
-- Done last, so the functions created above are covered too.

-- anon: nothing but the identity helpers RLS policies evaluate.
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
grant  execute on function public.current_tenant_id()      to anon;
grant  execute on function public.current_user_role()      to anon;
grant  execute on function public.current_user_can_write() to anon;

-- Drops Supabase's explicit default grant to anon for functions created later.
-- It does not remove the built-in grant to PUBLIC - see the rules at the top.
alter default privileges in schema public revoke execute on functions from anon;

revoke insert, update, delete on all tables in schema public from anon;
revoke truncate on all tables in schema public from anon, authenticated;

-- Posting tables: written only by the SECURITY DEFINER engines and RPCs.
revoke insert, update, delete on
  public.fact_balances,
  public.journal_header,
  public.task_run,
  public.workflow_run,
  public.ic_reconciliation,
  public.period_status
from authenticated;

-- Workers and internal helpers: reachable only from the wrappers, which run as
-- the function owner. Looked up by name so overloads cannot be missed.
do $do$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'run_bcf_entity',
         'run_bcf_group',
         'run_net_income_entity',
         'run_net_income_group',
         'run_currency_translation_entity',
         'run_ic_reconciliation',
         'run_ic_elimination',
         'run_coi_entity',
         'run_workflow_validation',
         'resolve_translation_rate',
         'assert_period_open',
         'workflow_deps_met',
         'refresh_cons_totals',
         'seed_demo_dataset_impl'
       ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$do$;

-- seed_demo_dataset changed signature; have PostgREST pick it up now.
notify pgrst, 'reload schema';

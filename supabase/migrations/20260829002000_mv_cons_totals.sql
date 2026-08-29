-- Phase 5 / Prompt 18 item 4: a pre-aggregated slice for the statements.
--
-- fact_balances keeps one row per posting, which is what makes drill-through
-- and reversal-by-task-run possible, but it means a group statement scans every
-- line a close ever wrote. mv_cons_totals collapses that to one row per
-- reporting coordinate.
--
-- A NOTE ON REFRESH. The view is refreshed at the end of a workflow run, and by
-- hand from the reports. It is therefore *stale by design* between closes, so
-- nothing that has to be exact reads it: the trial balance, drill-through and
-- audit trail all still go to fact_balances. Only the statement rollup - the
-- one report that aggregates the whole group - has the option of using it.
--
-- refresh_cons_totals() reports how long it took, so the cost of keeping it
-- current stays visible instead of quietly growing.

drop materialized view if exists public.mv_cons_totals;

create materialized view public.mv_cons_totals as
select f.tenant_id,
       f.cons_group_id,
       f.version_id,
       f.fiscal_year,
       f.period,
       f.posting_level,
       f.account_id,
       f.entity_id,
       sum(f.amount_lc) as amount_lc,
       sum(f.amount_gc) as amount_gc,
       count(*) as line_count
  from fact_balances f
 group by f.tenant_id, f.cons_group_id, f.version_id, f.fiscal_year, f.period,
          f.posting_level, f.account_id, f.entity_id;

-- Unique index is what allows REFRESH ... CONCURRENTLY, so a refresh does not
-- block readers mid-close. cons_group_id is nullable on entity-level rows, so
-- it is coalesced into the key.
create unique index mv_cons_totals_key on public.mv_cons_totals (
  tenant_id, coalesce(cons_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version_id, fiscal_year, period, posting_level, account_id, entity_id);

create index mv_cons_totals_slice on public.mv_cons_totals (
  tenant_id, version_id, fiscal_year, period, posting_level);

create or replace function public.refresh_cons_totals(p_concurrently boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start timestamptz := clock_timestamp();
  v_rows bigint;
begin
  if p_concurrently then
    refresh materialized view concurrently mv_cons_totals;
  else
    refresh materialized view mv_cons_totals;
  end if;

  select count(*) into v_rows from mv_cons_totals;

  return jsonb_build_object(
    'rows', v_rows,
    'elapsed_ms', round(extract(epoch from clock_timestamp() - v_start) * 1000));
end
$function$;

-- The materialised view has no row-level security of its own, so it is not
-- exposed to the API. Everything reaches it through this function, which
-- filters by the caller's tenant exactly as the underlying policies would.
revoke all on public.mv_cons_totals from anon, authenticated;

create or replace function public.report_cons_totals(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_levels text[] default array['00','01','05','10','20','30'],
  p_cons_group uuid default null)
returns table (
  account_code text, account_name text, statement_type text, account_class text,
  entity_code text, posting_level text, amount_lc numeric, amount_gc numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.code, a.name, a.statement_type, a.account_class,
         e.code, m.posting_level::text,
         round(sum(m.amount_lc), 2), round(sum(m.amount_gc), 2)
    from mv_cons_totals m
    join dim_account a on a.id = m.account_id
    join dim_entity  e on e.id = m.entity_id
   where m.tenant_id = current_tenant_id()
     and m.version_id = p_version
     and m.fiscal_year = p_year
     and m.period = p_period
     and m.posting_level = any(p_levels)
     and (p_cons_group is null or m.cons_group_id = p_cons_group or m.cons_group_id is null)
   group by a.code, a.name, a.statement_type, a.account_class, e.code, m.posting_level
   order by a.code, e.code;
$function$;

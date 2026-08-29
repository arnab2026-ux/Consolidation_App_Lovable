-- Phase 4 / Prompt 17: reporting.
--
-- POSTING LEVELS (decision D5). The three selectors the pack asks for map to:
--
--   Reported only            {00}
--   Reported + adjustments   {00, 01}
--   Fully consolidated       {00, 01, 05, 10, 20, 30}
--
-- Local-currency figures live at 00/01. Group-currency figures live at 05 and
-- above and nowhere else, because under D1 reported rows carry amount_gc = 0.
-- A group-currency report that omits 05 therefore returns zero rather than a
-- subtly wrong number - loud, which is the point.
--
-- Every report returns both currencies and lets the screen choose, so the same
-- function backs the local, group and side-by-side views.

-- ---------------------------------------------------------- trial balance
create or replace function public.report_trial_balance(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_levels text[] default array['00','01'],
  p_cons_group uuid default null,
  p_entities uuid[] default '{}'::uuid[])
returns table (
  entity_id uuid, entity_code text, entity_name text, local_currency text,
  account_id uuid, account_code text, account_name text,
  statement_type text, account_class text,
  movement_code text, movement_name text,
  posting_level text,
  amount_lc numeric, amount_gc numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.id, e.code, e.name, e.local_currency::text,
         a.id, a.code, a.name, a.statement_type, a.account_class,
         m.code, m.name, f.posting_level::text,
         round(sum(f.amount_lc), 2), round(sum(f.amount_gc), 2)
    from fact_balances f
    join dim_entity  e on e.id = f.entity_id
    join dim_account a on a.id = f.account_id
    left join dim_movement m on m.id = f.movement_id
   where f.tenant_id = current_tenant_id()
     and f.version_id = p_version
     and f.fiscal_year = p_year
     and f.period = p_period
     and f.posting_level = any(p_levels)
     and (p_cons_group is null
          or f.cons_group_id = p_cons_group
          or f.cons_group_id is null)
     and (coalesce(array_length(p_entities, 1), 0) = 0 or f.entity_id = any(p_entities))
   group by e.id, e.code, e.name, e.local_currency,
            a.id, a.code, a.name, a.statement_type, a.account_class,
            m.code, m.name, f.posting_level
  having round(sum(f.amount_lc), 2) <> 0 or round(sum(f.amount_gc), 2) <> 0
   order by e.code, a.code, m.code;
$function$;

-- ------------------------------------------------------- hierarchy rollup
-- Rolls balances up an account hierarchy using the recursive closure in
-- v_hierarchy_flat, honouring each node's aggregation sign. A comparison
-- period is rolled up alongside so the statement can show a variance without a
-- second round trip.
create or replace function public.report_statement(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_hierarchy_code text default 'AH_STD',
  p_levels text[] default array['00','01','05','10','20','30'],
  p_cons_group uuid default null,
  p_entities uuid[] default '{}'::uuid[],
  p_compare_year integer default null,
  p_compare_period integer default null)
returns table (
  node_code text, node_name text, parent_code text, node_order integer,
  is_leaf boolean, depth integer,
  amount_lc numeric, amount_gc numeric,
  compare_lc numeric, compare_gc numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with h as (
    select id from dim_hierarchy
     where tenant_id = current_tenant_id() and dim_code = 'ACCOUNT'
       and hierarchy_code = p_hierarchy_code
     limit 1
  ),
  facts as (
    select f.account_id, f.amount_lc, f.amount_gc, false as is_compare
      from fact_balances f
     where f.tenant_id = current_tenant_id()
       and f.version_id = p_version and f.fiscal_year = p_year and f.period = p_period
       and f.posting_level = any(p_levels)
       and (p_cons_group is null or f.cons_group_id = p_cons_group or f.cons_group_id is null)
       and (coalesce(array_length(p_entities, 1), 0) = 0 or f.entity_id = any(p_entities))
    union all
    select f.account_id, f.amount_lc, f.amount_gc, true
      from fact_balances f
     where p_compare_year is not null
       and f.tenant_id = current_tenant_id()
       and f.version_id = p_version
       and f.fiscal_year = p_compare_year
       and f.period = coalesce(p_compare_period, p_period)
       and f.posting_level = any(p_levels)
       and (p_cons_group is null or f.cons_group_id = p_cons_group or f.cons_group_id is null)
       and (coalesce(array_length(p_entities, 1), 0) = 0 or f.entity_id = any(p_entities))
  ),
  rolled as (
    select v.ancestor_code,
           sum(case when not fa.is_compare then fa.amount_lc * v.sign else 0 end) as amount_lc,
           sum(case when not fa.is_compare then fa.amount_gc * v.sign else 0 end) as amount_gc,
           sum(case when fa.is_compare then fa.amount_lc * v.sign else 0 end) as compare_lc,
           sum(case when fa.is_compare then fa.amount_gc * v.sign else 0 end) as compare_gc
      from v_hierarchy_flat v
      join h on h.id = v.hierarchy_id
      join dim_account a on a.tenant_id = current_tenant_id() and a.code = v.descendant_code
      join facts fa on fa.account_id = a.id
     group by v.ancestor_code
  )
  select n.member_code,
         coalesce(a.name, n.member_code),
         n.parent_member_code,
         n.node_order,
         a.id is not null,
         coalesce(d.depth, 0),
         round(coalesce(r.amount_lc, 0), 2),
         round(coalesce(r.amount_gc, 0), 2),
         round(coalesce(r.compare_lc, 0), 2),
         round(coalesce(r.compare_gc, 0), 2)
    from dim_hierarchy_node n
    join h on h.id = n.hierarchy_id
    left join dim_account a on a.tenant_id = current_tenant_id() and a.code = n.member_code
    left join rolled r on r.ancestor_code = n.member_code
    left join lateral (
      select max(v.depth) as depth from v_hierarchy_flat v
       where v.hierarchy_id = h.id and v.descendant_code = n.member_code
    ) d on true
   where n.tenant_id = current_tenant_id()
   order by n.node_order, n.member_code;
$function$;

-- ---------------------------------------------------------- drill-through
-- The single most important feature for auditability: from any figure, the
-- rows that produced it, with the document and task that wrote each one.
create or replace function public.report_drilldown(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_levels text[] default array['00','01','05','10','20','30'],
  p_cons_group uuid default null,
  p_account_code text default null,
  p_entity_id uuid default null)
returns table (
  fact_id bigint, posting_level text, entity_code text, account_code text,
  account_name text, movement_code text, partner_code text,
  amount_lc numeric, amount_gc numeric,
  source_task text, doc_number bigint, doc_type text, description text,
  task_type text, task_status text, created_at timestamptz, created_by_email text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.id, f.posting_level::text, e.code, a.code, a.name, m.code, p.code,
         f.amount_lc, f.amount_gc, f.source_task,
         j.doc_number, j.doc_type, j.description,
         t.task_type, t.status, f.created_at, u.email
    from fact_balances f
    join dim_entity  e on e.id = f.entity_id
    join dim_account a on a.id = f.account_id
    left join dim_movement m on m.id = f.movement_id
    left join dim_entity   p on p.id = f.partner_id
    left join journal_header j on j.id = f.journal_id
    left join task_run t on t.id = f.task_run_id
    left join app_user u on u.id = j.created_by
   where f.tenant_id = current_tenant_id()
     and f.version_id = p_version
     and f.fiscal_year = p_year
     and f.period = p_period
     and f.posting_level = any(p_levels)
     and (p_cons_group is null or f.cons_group_id = p_cons_group or f.cons_group_id is null)
     and (p_account_code is null or a.code = p_account_code)
     and (p_entity_id is null or f.entity_id = p_entity_id)
   order by f.posting_level, e.code, f.created_at;
$function$;

-- ------------------------------------------------------------ audit trail
create or replace function public.report_audit_trail(
  p_version uuid default null,
  p_year integer default null,
  p_period integer default null,
  p_doc_type text default null,
  p_posting_level text default null,
  p_limit integer default 500)
returns table (
  journal_id uuid, doc_number bigint, doc_type text, posting_level text,
  fiscal_year integer, period integer,
  entity_code text, cons_group_code text, description text,
  is_reversed boolean, created_at timestamptz, created_by_email text,
  task_type text, task_status text, line_count bigint,
  total_lc numeric, total_gc numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select j.id, j.doc_number, j.doc_type, j.posting_level::text,
         j.fiscal_year, j.period,
         e.code, g.code, j.description,
         j.is_reversed, j.created_at, u.email,
         t.task_type, t.status,
         count(f.id),
         round(coalesce(sum(f.amount_lc), 0), 2),
         round(coalesce(sum(f.amount_gc), 0), 2)
    from journal_header j
    left join dim_entity e on e.id = j.entity_id
    left join dim_cons_group g on g.id = j.cons_group_id
    left join app_user u on u.id = j.created_by
    left join task_run t on t.id = j.task_run_id
    left join fact_balances f on f.journal_id = j.id
   where j.tenant_id = current_tenant_id()
     and (p_version is null or j.version_id = p_version)
     and (p_year is null or j.fiscal_year = p_year)
     and (p_period is null or j.period = p_period)
     and (p_doc_type is null or j.doc_type = p_doc_type)
     and (p_posting_level is null or j.posting_level = p_posting_level)
   group by j.id, j.doc_number, j.doc_type, j.posting_level, j.fiscal_year, j.period,
            e.code, g.code, j.description, j.is_reversed, j.created_at, u.email,
            t.task_type, t.status
   order by j.doc_number desc
   limit greatest(coalesce(p_limit, 500), 1);
$function$;

-- Lines of one document, for the audit trail's expand.
create or replace function public.report_journal_lines(p_journal_id uuid)
returns table (
  fact_id bigint, entity_code text, account_code text, account_name text,
  movement_code text, partner_code text, posting_level text,
  amount_lc numeric, amount_gc numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.id, e.code, a.code, a.name, m.code, p.code, f.posting_level::text,
         f.amount_lc, f.amount_gc
    from fact_balances f
    join dim_entity  e on e.id = f.entity_id
    join dim_account a on a.id = f.account_id
    left join dim_movement m on m.id = f.movement_id
    left join dim_entity   p on p.id = f.partner_id
   where f.tenant_id = current_tenant_id() and f.journal_id = p_journal_id
   order by a.code, e.code;
$function$;

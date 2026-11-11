-- Accounting fixes found in the November 2026 code review.
--
-- Every function here is CREATE OR REPLACE with an unchanged signature, so the
-- generated types do not move and the grants set by
-- 20261111000100_security_hardening.sql are kept. Apply that migration first:
-- post_manual_journal below builds on its version (author = auth.uid()).
--
-- WHAT CHANGES
--
--  1. CONSOLIDATION OF INVESTMENTS - goodwill is frozen. run_coi_entity looked
--     up investment_register for exactly the period being run, so the register
--     row only applied in the acquisition period. One month later no row was
--     found and goodwill was re-derived from current net assets, drifting with
--     every period's result. It now uses the latest register row on or before
--     the period.
--
--  2. CONSOLIDATION OF INVESTMENTS - full goodwill. Under FULL_GOODWILL the
--     non-controlling interest was grossed up but goodwill was not, so the NCI's
--     share of goodwill landed in the retained-earnings plug. Goodwill is now
--     grossed up by the same amount. NCI is also `share of current net assets +
--     NCI goodwill` rather than a constant, so it follows the investee's
--     post-acquisition result as the proportionate method already did. At the
--     acquisition date both give the same NCI as before.
--
--  3. INTERCOMPANY ELIMINATION - per account. Each leg was posted to
--     `resolve_account_filter(...) limit 1`, an arbitrary single account, even
--     when the rule's filter matched several. Each leg is now reversed account
--     by account from the translated balances, so no account is left carrying an
--     intercompany balance and none is over-eliminated.
--
--  4. INTERCOMPANY ELIMINATION - a pair whose difference has nowhere to go is
--     reported as blocked instead of raising and aborting the whole run. That
--     was already the rule for DIFFERENCE pairs; a WITHIN_TOLERANCE pair with no
--     difference account configured used to take every other pair down with it.
--
--  5. BALANCE CARRY FORWARD - no double count of the prior-year result. A rule
--     with "P&L to retained earnings" carried the net-income equity line
--     (is_net_income) forward AND posted the P&L total to retained earnings.
--     When the net income step had run in the prior year those are the same
--     figure, and opening equity was out by it. The net income step's transfer
--     is now left behind whenever the rule transfers the P&L; anything else on
--     that line (the equity elimination consolidation of investments posts
--     there) goes to retained earnings with it. Entity and group paths.
--
--  6. MANUAL JOURNALS - level 30 reaches the consolidated statements. Group
--     adjustments were posted with amount_gc = 0, and translation only reads
--     levels 00/01, so they never appeared in group currency. A level-30 line's
--     amount is now also written to amount_gc: AT LEVEL 30 THE AMOUNT ENTERED IS
--     A GROUP-CURRENCY AMOUNT. amount_lc is still written as before so "copy
--     previous journal" keeps working.
--
--  7. MANUAL JOURNALS - the balance check. Level 01 must balance per entity
--     (each entity's books, in its own currency); the old check summed
--     amount_lc across entities with different currencies. Level 30 still
--     balances across the whole document, in group currency.
--
--  8. REPORTS - consolidation group scoping. With no group selected, rows of
--     every group were added together (an entity in two groups was counted
--     twice at level 05 and above); now only entity-level rows are returned.
--     With a group selected, entity-level rows of entities outside the group
--     were included; now only members with a consolidation method other than
--     NONE are. Trial balance, statement, drill-down and the totals slice.
--
--  9. GROUP NET INCOME - the reported total. With more than one active rule the
--     returned net_income figure re-added earlier rules' rows on every pass.
--     Postings were always right; only the number shown was overstated.
--
-- Also: the consolidation-of-investments residual is posted to the first
-- retained-earnings account by code rather than an arbitrary one.
--
-- DELIBERATELY NOT CHANGED - each needs a decision, not a patch
--
--  * investment_register.fair_value_adjustment_gc. As coded it debits goodwill
--    and, through the plug, credits retained earnings by the same amount. That
--    is not right under any reading, but the correct entry depends on what the
--    field means and on an account to carry the uplift. Leave it at zero until
--    that is settled.
--  * Period 0. Carry-forward rows are written to period 0 and nothing reads
--    them, because under D3 a period's figures are complete on their own. Fixing
--    subsequent consolidation, disposals and step acquisitions needs that
--    designed first.
--  * The historical-rate fallback to closing in resolve_translation_rate.
--  * Existing postings are not restated. Re-run the affected steps for any open
--    period to pick the fixes up.

-- ==================================================================== reports

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
     -- The group's own rows, plus entity-level rows: all of them when no group
     -- is selected, the group's members when one is.
     and (f.cons_group_id = p_cons_group
          or (f.cons_group_id is null
              and (p_cons_group is null
                   or exists (select 1 from cons_group_member gm
                               where gm.tenant_id = f.tenant_id
                                 and gm.cons_group_id = p_cons_group
                                 and gm.entity_id = f.entity_id
                                 and coalesce(gm.cons_method, '') <> 'NONE'))))
     and (coalesce(array_length(p_entities, 1), 0) = 0 or f.entity_id = any(p_entities))
   group by e.id, e.code, e.name, e.local_currency,
            a.id, a.code, a.name, a.statement_type, a.account_class,
            m.code, m.name, f.posting_level
  having round(sum(f.amount_lc), 2) <> 0 or round(sum(f.amount_gc), 2) <> 0
   order by e.code, a.code, m.code;
$function$;

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
       and (f.cons_group_id = p_cons_group
            or (f.cons_group_id is null
                and (p_cons_group is null
                     or exists (select 1 from cons_group_member gm
                                 where gm.tenant_id = f.tenant_id
                                   and gm.cons_group_id = p_cons_group
                                   and gm.entity_id = f.entity_id
                                   and coalesce(gm.cons_method, '') <> 'NONE'))))
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
       and (f.cons_group_id = p_cons_group
            or (f.cons_group_id is null
                and (p_cons_group is null
                     or exists (select 1 from cons_group_member gm
                                 where gm.tenant_id = f.tenant_id
                                   and gm.cons_group_id = p_cons_group
                                   and gm.entity_id = f.entity_id
                                   and coalesce(gm.cons_method, '') <> 'NONE'))))
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
     and (f.cons_group_id = p_cons_group
          or (f.cons_group_id is null
              and (p_cons_group is null
                   or exists (select 1 from cons_group_member gm
                               where gm.tenant_id = f.tenant_id
                                 and gm.cons_group_id = p_cons_group
                                 and gm.entity_id = f.entity_id
                                 and coalesce(gm.cons_method, '') <> 'NONE'))))
     and (p_account_code is null or a.code = p_account_code)
     and (p_entity_id is null or f.entity_id = p_entity_id)
   order by f.posting_level, e.code, f.created_at;
$function$;

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
     and (m.cons_group_id = p_cons_group
          or (m.cons_group_id is null
              and (p_cons_group is null
                   or exists (select 1 from cons_group_member gm
                               where gm.tenant_id = m.tenant_id
                                 and gm.cons_group_id = p_cons_group
                                 and gm.entity_id = m.entity_id
                                 and coalesce(gm.cons_method, '') <> 'NONE'))))
   group by a.code, a.name, a.statement_type, a.account_class, e.code, m.posting_level
   order by a.code, e.code;
$function$;

-- ============================================================ manual journals
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
  v_bad_entity text;
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

  if v_level = '01' then
    -- Entity level: each entity's own books must balance, in its own currency.
    -- A total across entities would add different currencies together.
    select x.entity_code, x.total
      into v_bad_entity, v_sum
      from (select l->>'entity_code' as entity_code,
                   round(sum(coalesce((l->>'amount_lc')::numeric, 0)), 2) as total
              from jsonb_array_elements(p_lines) l
             group by l->>'entity_code') x
     where x.total <> 0
     order by x.entity_code
     limit 1;
    if found then
      raise exception 'Journal is not balanced for entity %: debits minus credits = %',
        coalesce(v_bad_entity, '(none)'), v_sum;
    end if;
  else
    -- Group level: amounts are in group currency, so the document balances as
    -- a whole and may move value between entities.
    select round(sum(coalesce((l->>'amount_lc')::numeric, 0)), 2)
      into v_sum from jsonb_array_elements(p_lines) l;
    if coalesce(v_sum, 0) <> 0 then
      raise exception 'Journal is not balanced: debits minus credits = %', v_sum;
    end if;
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
         -- Entity rows carry no group-currency amount (D1): translation supplies
         -- it. A group adjustment is entered in group currency and nothing
         -- translates level 30, so it has to carry its own.
         case when v_level = '30' then coalesce((l->>'amount_lc')::numeric, 0) else 0 end,
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

-- =========================================================== group net income
-- Unchanged from 20260829000700 except that the totals are taken once, after
-- the loop, instead of re-adding the whole document on every rule.
create or replace function public.run_net_income_group(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid,
  p_year integer, p_period integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_account uuid;
  v_target_movement uuid;
  v_requires_movement boolean;
  v_group_ccy char(3);
  v_total_lc numeric(23,2) := 0;
  v_total_gc numeric(23,2) := 0;
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, p_period, p_cons_group);

  select group_currency into v_group_ccy
    from dim_cons_group where id = p_cons_group and tenant_id = p_tenant;
  if v_group_ccy is null then
    raise exception 'Consolidation group not found';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = p_period
     and source_task = 'NETINCOME' and posting_level in ('10', '20', '30');

  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = p_period and doc_type = 'NETINCOME';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'NETINCOME', '30', p_year, p_period, p_version, p_cons_group, p_task_run_id,
          format('Group net income to equity %s/%s', p_year, p_period))
  returning id into v_journal_id;

  for v_rule in
    select * from rule_net_income
     where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    select a.id, a.requires_movement into v_target_account, v_requires_movement
      from dim_account a
     where a.tenant_id = p_tenant and a.code = v_rule.target_bs_account_code;
    if v_target_account is null then
      raise exception 'Rule %: target balance sheet account % does not exist',
        v_rule.code, coalesce(v_rule.target_bs_account_code, '(not set)');
    end if;

    v_target_movement := null;
    if v_rule.target_movement_code is not null then
      select id into v_target_movement from dim_movement
       where tenant_id = p_tenant and code = v_rule.target_movement_code;
    end if;

    with src as (
      select f.entity_id, f.posting_level,
             max(f.local_currency) as local_currency,
             sum(f.amount_lc) as amount_lc,
             sum(f.amount_gc) as amount_gc
        from fact_balances f
        join dim_account a on a.id = f.account_id
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group
         and f.fiscal_year = p_year and f.period = p_period
         and f.posting_level in ('10', '20', '30')
         and a.statement_type = 'PL'
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.source_account_filter) r)
       group by 1, 2
      having sum(f.amount_lc) <> 0 or sum(f.amount_gc) <> 0
    )
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, src.entity_id, v_target_account,
           case when v_requires_movement then v_target_movement end,
           p_cons_group, p_version, p_year, p_period, src.posting_level,
           coalesce(src.local_currency, v_group_ccy), v_group_ccy,
           src.amount_lc, src.amount_gc, v_journal_id, p_task_run_id, 'NETINCOME'
      from src;

    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;
  end loop;

  select coalesce(sum(f.amount_lc), 0), coalesce(sum(f.amount_gc), 0)
    into v_total_lc, v_total_gc
    from fact_balances f
   where f.task_run_id = p_task_run_id and f.journal_id = v_journal_id;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;

  return jsonb_build_object(
    'rows_written'  , v_rows,
    'net_income_lc' , -v_total_lc,
    'net_income_gc' , -v_total_gc);
end
$function$;

-- ===================================================== intercompany elimination
create or replace function public.run_ic_elimination(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid,
  p_year integer, p_period integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pair record;
  v_journal uuid;
  v_group_ccy text;
  v_diff_code text;
  v_diff_account uuid;
  v_factor numeric;
  v_elim1 numeric(23,2);
  v_elim2 numeric(23,2);
  v_diff numeric(23,2);
  v_rows int := 0;
  v_step int;
  v_blocked int := 0;
  v_skipped int := 0;
  v_eliminated numeric(23,2) := 0;
begin
  perform assert_period_open(p_tenant, p_version, p_year, p_period, p_cons_group);

  if not exists (
    select 1 from ic_reconciliation
     where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
       and fiscal_year = p_year and period = p_period)
  then
    raise exception 'No reconciliation for %/% - run intercompany reconciliation first', p_year, p_period;
  end if;

  select g.group_currency::text into v_group_ccy
    from dim_cons_group g where g.id = p_cons_group and g.tenant_id = p_tenant;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = p_period
     and source_task = 'IC_ELIM' and posting_level = '10';

  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = p_period and doc_type = 'IC_ELIM';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'IC_ELIM', '10', p_year, p_period, p_version, p_cons_group, p_task_run_id,
          format('Intercompany elimination %s/%s', p_year, p_period))
  returning id into v_journal;

  for v_pair in
    select ic.*, r.code as rule_code, r.currency_diff_account_code, r.real_diff_account_code,
           r.leg1_account_filter, r.leg2_account_filter, r.is_two_sided,
           -- factor by consolidation method, never by raw ownership percentage
           least(
             case m1.cons_method when 'PURCHASE' then 1.0
                                 when 'PROPORTIONATE' then coalesce(m1.group_share_pct, 0) / 100
                                 else 0 end,
             case m2.cons_method when 'PURCHASE' then 1.0
                                 when 'PROPORTIONATE' then coalesce(m2.group_share_pct, 0) / 100
                                 else 0 end
           ) as factor
      from ic_reconciliation ic
      join rule_ic_elim r on r.id = ic.rule_id
      left join cons_group_member m1
        on m1.tenant_id = p_tenant and m1.cons_group_id = p_cons_group and m1.entity_id = ic.entity_id
      left join cons_group_member m2
        on m2.tenant_id = p_tenant and m2.cons_group_id = p_cons_group and m2.entity_id = ic.partner_id
     where ic.tenant_id = p_tenant and ic.version_id = p_version
       and ic.cons_group_id = p_cons_group and ic.fiscal_year = p_year and ic.period = p_period
     order by r.sequence nulls last, r.code
  loop
    v_factor := coalesce(v_pair.factor, 0);

    -- An equity-method counterparty is outside the group: the balance is a real
    -- external one and must survive consolidation.
    if v_factor = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_pair.status = 'ONE_SIDED' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_pair.status = 'DIFFERENCE' and coalesce(v_pair.real_diff_account_code, '') = '' then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    -- What reversing each leg comes to, account by account, at the group's
    -- share. Rounded per account so the amounts posted are the amounts summed.
    with legs as (
      select 1 as leg, round(-sum(f.amount_gc) * v_factor, 2) as elim
        from fact_balances f
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
         and f.period = p_period and f.posting_level = '05'
         and f.entity_id = v_pair.entity_id and f.partner_id = v_pair.partner_id
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_pair.leg1_account_filter) r)
       group by f.account_id
      union all
      select 2, round(-sum(f.amount_gc) * v_factor, 2)
        from fact_balances f
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
         and f.period = p_period and f.posting_level = '05'
         and f.entity_id = v_pair.partner_id and f.partner_id = v_pair.entity_id
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_pair.leg2_account_filter) r)
       group by f.account_id
    )
    select coalesce(sum(l.elim) filter (where l.leg = 1), 0),
           coalesce(sum(l.elim) filter (where l.leg = 2), 0)
      into v_elim1, v_elim2
      from legs l;

    v_diff := round(-(v_elim1 + v_elim2), 2);

    -- Whatever the two legs do not offset has to go somewhere, or the entry
    -- does not balance. Without a common transaction currency there is no
    -- honest way to attribute it to exchange movement, so the real-difference
    -- account is preferred. No account at all means the pair cannot be
    -- eliminated: report it, and carry on with the others.
    v_diff_account := null;
    if v_diff <> 0 then
      v_diff_code := coalesce(nullif(v_pair.real_diff_account_code, ''),
                              nullif(v_pair.currency_diff_account_code, ''));
      if v_diff_code is null then
        v_blocked := v_blocked + 1;
        continue;
      end if;

      select a.id into v_diff_account
        from dim_account a
       where a.tenant_id = p_tenant and a.code = v_diff_code;
      if v_diff_account is null then
        raise exception 'Rule %: difference account % does not exist',
          v_pair.rule_code, v_diff_code;
      end if;
    end if;

    -- Reverse leg 1, on each account that carries it.
    insert into fact_balances (
      tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, v_pair.entity_id, x.account_id, v_pair.partner_id, p_cons_group, p_version,
           p_year, p_period, '10', e.local_currency, v_group_ccy,
           0, 0, x.elim, v_journal, p_task_run_id, 'IC_ELIM'
      from (select f.account_id, round(-sum(f.amount_gc) * v_factor, 2) as elim
              from fact_balances f
             where f.tenant_id = p_tenant and f.version_id = p_version
               and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
               and f.period = p_period and f.posting_level = '05'
               and f.entity_id = v_pair.entity_id and f.partner_id = v_pair.partner_id
               and f.account_id in (select r.account_id
                                      from resolve_account_filter(p_tenant, v_pair.leg1_account_filter) r)
             group by f.account_id) x
      join dim_entity e on e.id = v_pair.entity_id
     where x.elim <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;

    -- Reverse leg 2, likewise.
    insert into fact_balances (
      tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, v_pair.partner_id, x.account_id, v_pair.entity_id, p_cons_group, p_version,
           p_year, p_period, '10', e.local_currency, v_group_ccy,
           0, 0, x.elim, v_journal, p_task_run_id, 'IC_ELIM'
      from (select f.account_id, round(-sum(f.amount_gc) * v_factor, 2) as elim
              from fact_balances f
             where f.tenant_id = p_tenant and f.version_id = p_version
               and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
               and f.period = p_period and f.posting_level = '05'
               and f.entity_id = v_pair.partner_id and f.partner_id = v_pair.entity_id
               and f.account_id in (select r.account_id
                                      from resolve_account_filter(p_tenant, v_pair.leg2_account_filter) r)
             group by f.account_id) x
      join dim_entity e on e.id = v_pair.partner_id
     where x.elim <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;

    if v_diff <> 0 then
      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      select p_tenant, v_pair.entity_id, v_diff_account, v_pair.partner_id, p_cons_group, p_version,
             p_year, p_period, '10', e.local_currency, v_group_ccy,
             0, 0, v_diff, v_journal, p_task_run_id, 'IC_ELIM'
        from dim_entity e where e.id = v_pair.entity_id;
      v_rows := v_rows + 1;
    end if;

    v_eliminated := v_eliminated + abs(v_elim1);
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal;
  end if;

  return jsonb_build_object(
    'rows_written'    , v_rows,
    'eliminated_gc'   , v_eliminated,
    'pairs_skipped'   , v_skipped,
    'pairs_blocked'   , v_blocked,
    'message'         , case when v_blocked > 0
                          then format('%s pair(s) with a difference were not eliminated because their rule has no difference account to post it to', v_blocked) end);
end
$function$;

-- ================================================ consolidation of investments
create or replace function public.run_coi_entity(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid,
  p_investee uuid, p_year integer, p_period integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member record;
  v_reg record;
  v_rule record;
  v_journal uuid;
  v_group_ccy text;
  v_investee_code text;
  v_investee_ccy text;
  v_gs numeric;          -- group share as a fraction
  v_mi numeric;          -- minority share as a fraction
  v_net_assets numeric(23,2);
  v_net_income numeric(23,2);
  v_investment numeric(23,2);
  v_na_acquired numeric(23,2);
  v_fva numeric(23,2);
  v_goodwill numeric(23,2) := 0;
  v_nci_goodwill numeric(23,2) := 0;
  v_nci numeric(23,2) := 0;
  v_pickup numeric(23,2) := 0;
  v_plug numeric(23,2);
  v_rows int := 0;
  v_step int;
  v_acct uuid;
  v_investor uuid;
begin
  perform assert_period_open(p_tenant, p_version, p_year, p_period, p_cons_group);

  select m.*, e.code, e.local_currency::text as lc
    into v_member
    from cons_group_member m
    join dim_entity e on e.id = m.entity_id
   where m.tenant_id = p_tenant and m.cons_group_id = p_cons_group and m.entity_id = p_investee;
  if not found then
    raise exception 'Entity is not a member of this consolidation group';
  end if;
  v_investee_code := v_member.code;
  v_investee_ccy := v_member.lc;
  v_gs := coalesce(v_member.group_share_pct, 0) / 100;
  v_mi := 1 - v_gs;

  select g.group_currency::text into v_group_ccy
    from dim_cons_group g where g.id = p_cons_group and g.tenant_id = p_tenant;

  if not exists (
    select 1 from fact_balances f
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.cons_group_id = p_cons_group and f.entity_id = p_investee
       and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05')
  then
    raise exception 'No translated balances for % at %/% - run currency translation first',
      v_investee_code, p_year, p_period;
  end if;

  select * into v_rule
    from rule_coi
   where tenant_id = p_tenant and coalesce(is_active, true)
     and cons_method = v_member.cons_method
   order by sequence nulls last, code
   limit 1;
  if not found then
    raise exception 'No active consolidation-of-investments rule for method %', v_member.cons_method;
  end if;

  -- The most recent register entry on or before this period. Matching the
  -- period exactly meant the acquisition figures applied for one period only,
  -- and goodwill was re-derived from current net assets in every later one.
  select * into v_reg
    from investment_register
   where tenant_id = p_tenant and cons_group_id = p_cons_group
     and investee_entity_id = p_investee
     and (fiscal_year < p_year or (fiscal_year = p_year and period <= p_period))
   order by fiscal_year desc, period desc, id desc
   limit 1;

  if v_reg.activity in ('PARTIAL_DISPOSAL', 'TOTAL_DISPOSAL', 'STEP_ACQUISITION') then
    raise exception 'Activity % is not implemented yet: it needs prior-period goodwill and NCI carried forward by a group balance carry forward',
      v_reg.activity;
  end if;

  -- --------------------------------------------------------------- measures
  select -coalesce(sum(f.amount_gc) filter (where a.account_class = 'EQUITY'), 0),
         -coalesce(sum(f.amount_gc) filter (where a.is_net_income), 0)
    into v_net_assets, v_net_income
    from fact_balances f
    join dim_account a on a.id = f.account_id
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.cons_group_id = p_cons_group and f.entity_id = p_investee
     and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05';

  -- The investor's carrying amount for this investee, whoever holds it.
  select coalesce(sum(f.amount_gc), 0)
    into v_investment
    from fact_balances f
    join dim_account a on a.id = f.account_id
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.cons_group_id = p_cons_group and f.partner_id = p_investee
     and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
     and a.is_investment_account;

  select f.entity_id
    into v_investor
    from fact_balances f
    join dim_account a on a.id = f.account_id
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.cons_group_id = p_cons_group and f.partner_id = p_investee
     and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
     and a.is_investment_account and f.amount_gc <> 0
   order by abs(f.amount_gc) desc
   limit 1;

  v_na_acquired := coalesce(v_reg.net_assets_acquired_gc, v_net_assets);
  v_fva := coalesce(v_reg.fair_value_adjustment_gc, 0);

  -- ----------------------------------------------------------- housekeeping
  -- Deleting this investee's own COI document is enough: fact_balances.journal_id
  -- cascades from journal_header. Scoping by entity instead would reach rows
  -- posted against a shared investor by a different investee's run.
  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and entity_id = p_investee and fiscal_year = p_year and period = p_period
     and doc_type = 'COI';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, entity_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'COI', '20', p_year, p_period, p_version, p_investee, p_cons_group, p_task_run_id,
          format('Consolidation of investments %s (%s) %s/%s',
                 v_investee_code, v_member.cons_method, p_year, p_period))
  returning id into v_journal;

  -- =========================================================== PROPORTIONATE
  -- Only the group's share of the investee belongs in the accounts, so the
  -- minority portion of every reported line is reduced away first.
  if v_member.cons_method = 'PROPORTIONATE' then
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, f.entity_id, f.account_id, f.movement_id, f.partner_id, p_cons_group,
           p_version, p_year, p_period, '20', f.local_currency, v_group_ccy,
           0, 0, round(-f.amount_gc * v_mi, 2), v_journal, p_task_run_id, 'COI'
      from fact_balances f
      join dim_account a on a.id = f.account_id
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.cons_group_id = p_cons_group and f.entity_id = p_investee
       and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
       and a.account_class <> 'EQUITY'      -- equity is removed in full below
       and not a.is_net_income              -- D9: left for group net income
       and round(f.amount_gc * v_mi, 2) <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;
  end if;

  -- ================================================== PURCHASE / PROPORTIONATE
  if v_member.cons_method in ('PURCHASE', 'PROPORTIONATE') then
    -- Remove the investee's equity in full.
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, f.entity_id, f.account_id, f.movement_id, p_cons_group,
           p_version, p_year, p_period, '20', f.local_currency, v_group_ccy,
           0, 0, -f.amount_gc, v_journal, p_task_run_id, 'COI'
      from fact_balances f
      join dim_account a on a.id = f.account_id
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.cons_group_id = p_cons_group and f.entity_id = p_investee
       and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
       and a.account_class = 'EQUITY' and f.amount_gc <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;

    -- Remove the investor's carrying amount.
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, f.entity_id, f.account_id, f.movement_id, f.partner_id, p_cons_group,
           p_version, p_year, p_period, '20', f.local_currency, v_group_ccy,
           0, 0, -f.amount_gc, v_journal, p_task_run_id, 'COI'
      from fact_balances f
      join dim_account a on a.id = f.account_id
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.cons_group_id = p_cons_group and f.partner_id = p_investee
       and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
       and a.is_investment_account and f.amount_gc <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;

    -- Goodwill attributable to the group: cost plus fair value adjustments,
    -- less the group's share of the net assets acquired. Frozen from the
    -- register when it is there; otherwise derived from current net assets,
    -- which is the first-consolidation case.
    v_goodwill := round(v_investment + v_fva - v_gs * v_na_acquired, 2);

    -- Non-controlling interests. PROPORTIONATE recognises none: the minority
    -- portion was reduced away rather than presented as an interest in equity.
    if v_member.cons_method = 'PURCHASE' and v_mi > 0 then
      if coalesce(v_reg.nci_measurement, 'PROPORTIONATE') = 'FULL_GOODWILL' then
        if v_gs = 0 then
          raise exception 'Full goodwill needs a group share above zero for %', v_investee_code;
        end if;
        -- The price paid for the group's share implies a value for the whole
        -- investee of cost / share. The NCI's part of the goodwill in that
        -- value is recognised on both sides: more goodwill, more NCI. Posting
        -- only the NCI side sent the difference to retained earnings.
        v_nci_goodwill := round(v_mi * (v_investment / v_gs - v_na_acquired), 2);
        v_goodwill := v_goodwill + v_nci_goodwill;
      end if;

      -- Share of the investee's net assets today, plus the NCI's goodwill when
      -- it is measured at full goodwill. At the acquisition date the latter
      -- reduces to minority share x cost / group share.
      v_nci := round(v_mi * v_net_assets, 2) + v_nci_goodwill;

      if coalesce(v_rule.nci_equity_account_code, '') = '' then
        raise exception 'Rule %: a non-controlling interest of % needs an NCI equity account',
          v_rule.code, v_nci;
      end if;
      select a.id into v_acct from dim_account a
       where a.tenant_id = p_tenant and a.code = v_rule.nci_equity_account_code;

      insert into fact_balances (
        tenant_id, entity_id, account_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      values (p_tenant, p_investee, v_acct, p_cons_group, p_version, p_year, p_period, '20',
              v_investee_ccy, v_group_ccy, 0, 0, -v_nci, v_journal, p_task_run_id, 'COI');
      v_rows := v_rows + 1;
    end if;

    -- Goodwill, or a bargain purchase gain when it comes out negative.
    if v_goodwill <> 0 then
      select a.id into v_acct from dim_account a
       where a.tenant_id = p_tenant
         and a.code = case when v_goodwill > 0 then v_rule.goodwill_account_code
                           else coalesce(v_rule.badwill_account_code, v_rule.goodwill_account_code) end;
      if v_acct is null then
        raise exception 'Rule %: goodwill of % needs a goodwill or badwill account', v_rule.code, v_goodwill;
      end if;

      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      values (p_tenant, coalesce(v_investor, p_investee), v_acct,
              case when v_investor is null then null else p_investee end,
              p_cons_group, p_version, p_year, p_period, '20',
              v_group_ccy, v_group_ccy, 0, 0, v_goodwill, v_journal, p_task_run_id, 'COI');
      v_rows := v_rows + 1;
    end if;
  end if;

  -- ================================================================= EQUITY
  -- The investee is outside the group: strip its reported data out entirely,
  -- then bring back the group's share of its result.
  if v_member.cons_method = 'EQUITY' then
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, f.entity_id, f.account_id, f.movement_id, f.partner_id, p_cons_group,
           p_version, p_year, p_period, '20', f.local_currency, v_group_ccy,
           0, 0, -f.amount_gc, v_journal, p_task_run_id, 'COI'
      from fact_balances f
      join dim_account a on a.id = f.account_id
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.cons_group_id = p_cons_group and f.entity_id = p_investee
       and f.fiscal_year = p_year and f.period = p_period and f.posting_level = '05'
       and not a.is_net_income               -- D9
       and f.amount_gc <> 0;
    get diagnostics v_step = row_count;
    v_rows := v_rows + v_step;

    v_pickup := round(v_gs * v_net_income, 2);
    if v_pickup <> 0 then
      if coalesce(v_rule.equity_pickup_account_code, '') = ''
         or coalesce(v_rule.equity_income_account_code, '') = '' then
        raise exception 'Rule %: the equity method needs a pickup account and an income account', v_rule.code;
      end if;

      select a.id into v_acct from dim_account a
       where a.tenant_id = p_tenant and a.code = v_rule.equity_pickup_account_code;
      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      values (p_tenant, coalesce(v_investor, p_investee), v_acct, p_investee, p_cons_group, p_version,
              p_year, p_period, '20', v_group_ccy, v_group_ccy, 0, 0, v_pickup,
              v_journal, p_task_run_id, 'COI');

      select a.id into v_acct from dim_account a
       where a.tenant_id = p_tenant and a.code = v_rule.equity_income_account_code;
      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      values (p_tenant, coalesce(v_investor, p_investee), v_acct, p_investee, p_cons_group, p_version,
              p_year, p_period, '20', v_group_ccy, v_group_ccy, 0, 0, -v_pickup,
              v_journal, p_task_run_id, 'COI');
      v_rows := v_rows + 2;
    end if;
  end if;

  -- ------------------------------------------------------------- the plug
  -- Whatever the entry has not yet balanced is the group's share of the
  -- investee's post-acquisition reserves, and belongs in group retained
  -- earnings. When acquisition-date and current net assets coincide - the
  -- first-consolidation case - this is zero.
  select -coalesce(sum(f.amount_gc), 0) into v_plug
    from fact_balances f
   where f.task_run_id = p_task_run_id and f.journal_id = v_journal;

  if v_plug <> 0 then
    select a.id into v_acct from dim_account a
     where a.tenant_id = p_tenant and a.is_retained_earnings
     order by a.code
     limit 1;
    if v_acct is null then
      raise exception 'No retained earnings account is flagged, so the residual of % cannot be posted', v_plug;
    end if;

    insert into fact_balances (
      tenant_id, entity_id, account_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    values (p_tenant, p_investee, v_acct, p_cons_group, p_version, p_year, p_period, '20',
            v_investee_ccy, v_group_ccy, 0, 0, v_plug, v_journal, p_task_run_id, 'COI');
    v_rows := v_rows + 1;
  end if;

  if v_rows = 0 then
    delete from journal_header where id = v_journal;
  end if;

  -- Feed the computed figures back to the register so the screen can show the
  -- derivation and a later period can freeze against it.
  if v_reg.id is not null then
    update investment_register
       set goodwill_gc = v_goodwill,
           net_assets_acquired_gc = coalesce(net_assets_acquired_gc, v_net_assets),
           is_posted = true
     where id = v_reg.id;
  end if;

  return jsonb_build_object(
    'method'            , v_member.cons_method,
    'group_share_pct'   , round(v_gs * 100, 4),
    'net_assets_gc'     , v_net_assets,
    'net_income_gc'     , v_net_income,
    'investment_gc'     , v_investment,
    'goodwill_gc'       , v_goodwill,
    'nci_goodwill_gc'   , v_nci_goodwill,
    'nci_equity_gc'     , v_nci,
    'nci_pl_gc'         , round(v_mi * v_net_income, 2),
    'equity_pickup_gc'  , v_pickup,
    'residual_gc'       , v_plug,
    'rows_written'      , v_rows);
end
$function$;

-- ======================================================= balance carry forward
-- Both functions are unchanged from 20260829000600 except for one condition in
-- the balance-sheet carry: the net-income equity line is skipped when the rule
-- also transfers the P&L to retained earnings.

create or replace function public.run_bcf_entity(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_entity uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_entity_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
  v_prior_close int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, null);

  -- Balances are year-to-date (see docs/DECISIONS.md D3), so the prior year's
  -- closing position is the single highest period carrying data - NOT the sum
  -- of every period.
  select max(f.period) into v_prior_close
    from fact_balances f
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.fiscal_year = p_year - 1
     and f.entity_id = p_entity and f.cons_group_id is null
     and f.posting_level in ('00', '01');
  if v_prior_close is null then
    return 0;
  end if;

  select local_currency into v_entity_ccy
    from dim_entity where id = p_entity and tenant_id = p_tenant;
  if v_entity_ccy is null then
    raise exception 'Entity not found or has no local currency';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and cons_group_id is null and fiscal_year = p_year and period = 0
     and source_task = 'BCF' and posting_level = '01';

  -- Clear the previous run's document as well, or repeated runs leave empty
  -- BCF journals behind and the audit trail fills with phantom documents.
  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and fiscal_year = p_year and period = 0 and doc_type = 'BCF';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, entity_id, task_run_id, description)
  values (p_tenant, 'BCF', '01', p_year, 0, p_version, p_entity, p_task_run_id,
          format('Entity balance carry forward %s -> %s', p_year - 1, p_year))
  returning id into v_journal_id;

  for v_rule in
    select * from rule_bcf where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    select id into v_target_movement from dim_movement
     where tenant_id = p_tenant and code = v_rule.target_movement_code;
    if v_target_movement is null then
      raise exception 'Rule %: target movement code % does not exist',
        v_rule.code, v_rule.target_movement_code;
    end if;

    with src as (
      select f.account_id,
             a.requires_movement,
             case when v_rule.carry_partner then f.partner_id else null end as partner_id,
             case when v_rule.carry_custom_dims then f.zdim01 else null end as zdim01,
             case when v_rule.carry_custom_dims then f.zdim02 else null end as zdim02,
             case when v_rule.carry_custom_dims then f.zdim03 else null end as zdim03,
             case when v_rule.carry_custom_dims then f.zdim04 else null end as zdim04,
             case when v_rule.carry_custom_dims then f.zdim05 else null end as zdim05,
             max(f.local_currency) as local_currency,
             max(f.group_currency) as group_currency,
             sum(f.amount_lc) as amount_lc,
             sum(f.amount_gc) as amount_gc
        from fact_balances f
        join dim_account a on a.id = f.account_id
        left join dim_movement m on m.id = f.movement_id
       where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
         and f.cons_group_id is null and f.fiscal_year = p_year - 1
         and f.period = v_prior_close
         and f.posting_level in ('00', '01')
         and a.statement_type in ('BS', 'OCI')
         -- The net-income equity line is last year's P&L, already in equity.
         -- The transfer below brings that same result into retained earnings,
         -- so carrying the line as well would count it twice.
         and not (coalesce(v_rule.pl_to_retained_earnings, false)
                  and coalesce(a.is_net_income, false))
         and (v_rule.source_movement_class is null
              or array_length(v_rule.source_movement_class, 1) is null
              or f.movement_id is null
              or m.movement_class = any(v_rule.source_movement_class))
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.source_account_filter) r)
       group by 1, 2, 3, 4, 5, 6, 7, 8
      having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
    )
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, version_id,
      fiscal_year, period, posting_level, zdim01, zdim02, zdim03, zdim04, zdim05,
      local_currency, group_currency, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, p_entity, src.account_id,
           case when src.requires_movement then v_target_movement end,
           src.partner_id, p_version,
           p_year, 0, '01', src.zdim01, src.zdim02, src.zdim03, src.zdim04, src.zdim05,
           coalesce(src.local_currency, v_entity_ccy), coalesce(src.group_currency, v_entity_ccy),
           src.amount_lc, src.amount_gc, v_journal_id, p_task_run_id, 'BCF'
      from src;
    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;

    if v_rule.pl_to_retained_earnings then
      select id into v_re_account from dim_account
       where tenant_id = p_tenant and code = v_rule.retained_earnings_account_code;
      if v_re_account is null then
        raise exception 'Rule %: retained earnings account % does not exist',
          v_rule.code, coalesce(v_rule.retained_earnings_account_code, '(not set)');
      end if;

      with src as (
        select max(f.local_currency) as local_currency,
               max(f.group_currency) as group_currency,
               sum(f.amount_lc) as amount_lc,
               sum(f.amount_gc) as amount_gc
          from fact_balances f
          join dim_account a on a.id = f.account_id
         where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
           and f.cons_group_id is null and f.fiscal_year = p_year - 1
           and f.period = v_prior_close
           and f.posting_level in ('00', '01')
           -- The P&L, plus anything on the net-income line that is not the
           -- net income step's own transfer of that P&L (which would repeat it).
           and (a.statement_type = 'PL'
                or (coalesce(a.is_net_income, false) and f.source_task <> 'NETINCOME'))
        having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
      )
      insert into fact_balances (
        tenant_id, entity_id, account_id, movement_id, version_id, fiscal_year, period,
        posting_level, local_currency, group_currency, amount_lc, amount_gc,
        journal_id, task_run_id, source_task)
      select p_tenant, p_entity, v_re_account, v_target_movement, p_version, p_year, 0, '01',
             coalesce(src.local_currency, v_entity_ccy), coalesce(src.group_currency, v_entity_ccy),
             src.amount_lc, src.amount_gc, v_journal_id, p_task_run_id, 'BCF'
        from src;
      get diagnostics v_step_rows = row_count;
      v_rows := v_rows + v_step_rows;
    end if;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;
  return v_rows;
end
$function$;

create or replace function public.run_bcf_group(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_group_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
  v_prior_close int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, p_cons_group);

  -- Year-to-date model (D3): the prior year's closing position is the single
  -- highest period carrying data.
  select max(f.period) into v_prior_close
    from fact_balances f
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.fiscal_year = p_year - 1
     and f.cons_group_id = p_cons_group
     and f.posting_level in ('10', '20', '30');
  if v_prior_close is null then
    return 0;
  end if;

  select group_currency into v_group_ccy
    from dim_cons_group where id = p_cons_group and tenant_id = p_tenant;
  if v_group_ccy is null then
    raise exception 'Consolidation group not found';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = 0 and source_task = 'BCF'
     and posting_level in ('10', '20', '30');

  -- Same cleanup as the entity path: drop the prior run's empty document.
  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = 0 and doc_type = 'BCF';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'BCF', '30', p_year, 0, p_version, p_cons_group, p_task_run_id,
          format('Group balance carry forward %s -> %s', p_year - 1, p_year))
  returning id into v_journal_id;

  for v_rule in
    select * from rule_bcf where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    select id into v_target_movement from dim_movement
     where tenant_id = p_tenant and code = v_rule.target_movement_code;
    if v_target_movement is null then
      raise exception 'Rule %: target movement code % does not exist',
        v_rule.code, v_rule.target_movement_code;
    end if;

    with src as (
      select f.entity_id, f.account_id, f.posting_level,
             a.requires_movement,
             case when v_rule.carry_partner then f.partner_id else null end as partner_id,
             case when v_rule.carry_custom_dims then f.zdim01 else null end as zdim01,
             case when v_rule.carry_custom_dims then f.zdim02 else null end as zdim02,
             case when v_rule.carry_custom_dims then f.zdim03 else null end as zdim03,
             case when v_rule.carry_custom_dims then f.zdim04 else null end as zdim04,
             case when v_rule.carry_custom_dims then f.zdim05 else null end as zdim05,
             max(f.local_currency) as local_currency,
             sum(f.amount_lc) as amount_lc,
             sum(f.amount_gc) as amount_gc
        from fact_balances f
        join dim_account a on a.id = f.account_id
        left join dim_movement m on m.id = f.movement_id
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year - 1
         and f.period = v_prior_close
         and f.posting_level in ('10', '20', '30')
         and a.statement_type in ('BS', 'OCI')
         -- See run_bcf_entity: the net-income line and the P&L transfer below
         -- are the same result.
         and not (coalesce(v_rule.pl_to_retained_earnings, false)
                  and coalesce(a.is_net_income, false))
         and (v_rule.source_movement_class is null
              or array_length(v_rule.source_movement_class, 1) is null
              or f.movement_id is null
              or m.movement_class = any(v_rule.source_movement_class))
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.source_account_filter) r)
       group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
      having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
    )
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, zdim01, zdim02, zdim03, zdim04, zdim05,
      local_currency, group_currency, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, src.entity_id, src.account_id,
           case when src.requires_movement then v_target_movement end,
           src.partner_id, p_cons_group, p_version, p_year, 0, src.posting_level,
           src.zdim01, src.zdim02, src.zdim03, src.zdim04, src.zdim05,
           src.local_currency, v_group_ccy, src.amount_lc, src.amount_gc,
           v_journal_id, p_task_run_id, 'BCF'
      from src;
    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;

    if v_rule.pl_to_retained_earnings then
      select id into v_re_account from dim_account
       where tenant_id = p_tenant and code = v_rule.retained_earnings_account_code;
      if v_re_account is null then
        raise exception 'Rule %: retained earnings account % does not exist',
          v_rule.code, coalesce(v_rule.retained_earnings_account_code, '(not set)');
      end if;

      with src as (
        select f.entity_id, f.posting_level, max(f.local_currency) as local_currency,
               sum(f.amount_lc) as amount_lc, sum(f.amount_gc) as amount_gc
          from fact_balances f
          join dim_account a on a.id = f.account_id
         where f.tenant_id = p_tenant and f.version_id = p_version
           and f.cons_group_id = p_cons_group and f.fiscal_year = p_year - 1
           and f.period = v_prior_close
           and f.posting_level in ('10', '20', '30')
           -- The P&L, plus what consolidation of investments posted on the
           -- net-income line when it removed an investee's equity. That is a
           -- real elimination and follows the investee's result into retained
           -- earnings; only the net income step's own transfer is a repeat.
           and (a.statement_type = 'PL'
                or (coalesce(a.is_net_income, false) and f.source_task <> 'NETINCOME'))
         group by 1, 2
        having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
      )
      insert into fact_balances (
        tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency, amount_lc, amount_gc,
        journal_id, task_run_id, source_task)
      select p_tenant, src.entity_id, v_re_account, v_target_movement, null,
             p_cons_group, p_version, p_year, 0, src.posting_level,
             src.local_currency, v_group_ccy, src.amount_lc, src.amount_gc,
             v_journal_id, p_task_run_id, 'BCF'
        from src;
      get diagnostics v_step_rows = row_count;
      v_rows := v_rows + v_step_rows;
    end if;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;
  return v_rows;
end
$function$;

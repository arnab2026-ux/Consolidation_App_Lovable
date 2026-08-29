-- Phase 2 / Prompt 12: net income transfer to equity.
--
-- Follows the shape already established by Balance Carry Forward, because the
-- BCF screen is the house pattern the remaining engine screens copy:
--
--   run_net_income()          wrapper - takes entity and group lists, creates
--                             one task_run per target, catches per-target
--                             errors, returns a result row per target.
--   run_net_income_entity()   worker - reported data (levels 00/01) -> level 01.
--   run_net_income_group()    worker - consolidation postings (10/20/30) ->
--                             the same level under the consolidation group.
--
-- Sign convention. Balances are stored debit-positive, so a profitable entity
-- has sum(P&L) < 0 and a balance sheet that foots to a positive number: assets
-- exceed liabilities and equity by exactly the result not yet taken to equity.
-- Posting sum(P&L) unchanged to the equity account therefore closes the gap.
-- The pack calls this "sign inverted"; in this convention it is the identity,
-- and inverting it would double the imbalance instead of clearing it.
--
-- After the transfer the balance sheet foots to zero while the P&L accounts
-- still carry the result. That duplication is deliberate and standard - the
-- two statements are presented separately - so the check that matters is
-- "assets = liabilities + equity", not "every row sums to zero". That is what
-- verify_balance_sheet() below reports and what the screen's verification card
-- shows.
--
-- Non-controlling interests are NOT split here, despite rule_net_income
-- carrying split_to_minority and minority_account_code. See decision D4:
-- Prompt 12 and Prompt 15 both claim the NCI profit split, and doing it in
-- both places would double count. It belongs to consolidation of investments,
-- which knows the method, holds both NCI accounts, and handles first versus
-- subsequent consolidation.

-- ------------------------------------------------------------ entity worker
create or replace function public.run_net_income_entity(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_entity uuid,
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
  v_entity_ccy char(3);
  v_amount_lc numeric(23,2);
  v_amount_gc numeric(23,2);
  v_total_lc numeric(23,2) := 0;
  v_total_gc numeric(23,2) := 0;
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, p_period, null);

  select local_currency into v_entity_ccy
    from dim_entity where id = p_entity and tenant_id = p_tenant;
  if v_entity_ccy is null then
    raise exception 'Entity not found or has no local currency';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and cons_group_id is null and fiscal_year = p_year and period = p_period
     and source_task = 'NETINCOME' and posting_level = '01';

  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and fiscal_year = p_year and period = p_period and doc_type = 'NETINCOME';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, entity_id, task_run_id, description)
  values (p_tenant, 'NETINCOME', '01', p_year, p_period, p_version, p_entity, p_task_run_id,
          format('Net income to equity %s/%s', p_year, p_period))
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
      if v_target_movement is null then
        raise exception 'Rule %: target movement code % does not exist',
          v_rule.code, v_rule.target_movement_code;
      end if;
    end if;

    -- Balances are year-to-date, so the result is the P&L at this period -
    -- never a sum across periods (decision D3).
    select coalesce(sum(f.amount_lc), 0), coalesce(sum(f.amount_gc), 0)
      into v_amount_lc, v_amount_gc
      from fact_balances f
      join dim_account a on a.id = f.account_id
     where f.tenant_id = p_tenant and f.version_id = p_version
       and f.entity_id = p_entity and f.cons_group_id is null
       and f.fiscal_year = p_year and f.period = p_period
       and f.posting_level in ('00', '01')
       and a.statement_type = 'PL'
       and f.account_id in (select r.account_id
                              from resolve_account_filter(p_tenant, v_rule.source_account_filter) r);

    if v_amount_lc = 0 and v_amount_gc = 0 then
      continue;
    end if;

    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, version_id, fiscal_year, period,
      posting_level, local_currency, group_currency, amount_lc, amount_gc,
      journal_id, task_run_id, source_task)
    values (
      p_tenant, p_entity, v_target_account,
      case when v_requires_movement then v_target_movement end,
      p_version, p_year, p_period, '01', v_entity_ccy, v_entity_ccy,
      v_amount_lc, v_amount_gc, v_journal_id, p_task_run_id, 'NETINCOME');

    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;
    v_total_lc := v_total_lc + v_amount_lc;
    v_total_gc := v_total_gc + v_amount_gc;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;

  -- Reported debit-positive internally; reported back as a profit-positive
  -- figure, which is what a reader of the screen expects to see.
  return jsonb_build_object(
    'rows_written'  , v_rows,
    'net_income_lc' , -v_total_lc,
    'net_income_gc' , -v_total_gc);
end
$function$;

-- ------------------------------------------------------------- group worker
-- Consolidation postings (IC elimination at 10, consolidation of investments
-- at 20, group manual adjustments at 30) carry their own P&L effects. Those
-- have to reach equity too, or the consolidated balance sheet stops footing
-- once eliminations land. Each level's result is transferred at that same
-- level so the audit trail stays legible.
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

    select v_total_lc + coalesce(sum(f.amount_lc), 0),
           v_total_gc + coalesce(sum(f.amount_gc), 0)
      into v_total_lc, v_total_gc
      from fact_balances f
     where f.task_run_id = p_task_run_id and f.journal_id = v_journal_id;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;

  return jsonb_build_object(
    'rows_written'  , v_rows,
    'net_income_lc' , -v_total_lc,
    'net_income_gc' , -v_total_gc);
end
$function$;

-- ----------------------------------------------------------------- wrapper
create or replace function public.run_net_income(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_entities uuid[] default '{}'::uuid[],
  p_groups uuid[] default '{}'::uuid[])
returns table (
  task_run_id uuid, target_kind text, target_id uuid, target_code text,
  target_name text, net_income_lc numeric, net_income_gc numeric,
  rows_written integer, status text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_target record;
  v_task uuid;
  v_result jsonb;
  v_rows int;
  v_status text;
  v_message text;
  v_ni_lc numeric;
  v_ni_gc numeric;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_version is null or p_year is null or p_period is null then
    raise exception 'Version, fiscal year and period are required';
  end if;

  for v_target in
    select 'ENTITY'::text as kind, e.id, e.code, e.name
      from dim_entity e
     where e.tenant_id = v_tenant and e.id = any(coalesce(p_entities, '{}'::uuid[]))
    union all
    select 'GROUP'::text, g.id, g.code, g.name
      from dim_cons_group g
     where g.tenant_id = v_tenant and g.id = any(coalesce(p_groups, '{}'::uuid[]))
    order by 1, 3
  loop
    insert into task_run (tenant_id, task_type, entity_id, cons_group_id, version_id,
                          fiscal_year, period, status, started_at, run_by)
    values (v_tenant, 'NET_INCOME',
            case when v_target.kind = 'ENTITY' then v_target.id end,
            case when v_target.kind = 'GROUP'  then v_target.id end,
            p_version, p_year, p_period, 'RUNNING', now(), auth.uid())
    returning id into v_task;

    begin
      if v_target.kind = 'ENTITY' then
        v_result := run_net_income_entity(v_task, v_tenant, p_version, v_target.id, p_year, p_period);
      else
        v_result := run_net_income_group(v_task, v_tenant, p_version, v_target.id, p_year, p_period);
      end if;
      v_rows  := (v_result->>'rows_written')::int;
      v_ni_lc := (v_result->>'net_income_lc')::numeric;
      v_ni_gc := (v_result->>'net_income_gc')::numeric;
      v_status := case when v_rows = 0 then 'WARNING' else 'SUCCESS' end;
      v_message := case when v_rows = 0
                        then 'No profit and loss balances matched the active rules' end;
    exception when others then
      v_rows := 0; v_ni_lc := null; v_ni_gc := null;
      v_status := 'ERROR'; v_message := sqlerrm;
    end;

    update task_run
       set status = v_status, rows_written = v_rows, message = v_message, finished_at = now(),
           journal_id = (select id from journal_header where task_run_id = v_task limit 1)
     where id = v_task;

    return query select v_task, v_target.kind, v_target.id, v_target.code, v_target.name,
                        v_ni_lc, v_ni_gc, v_rows, v_status, v_message;
  end loop;
end
$function$;

-- ------------------------------------------------------------ verification
-- Powers the screen's verification card, and is reusable by the reports in
-- Phase 4. Returns profit-positive, reader-facing figures: assets and
-- liabilities-plus-equity both as positive totals, and the difference that
-- must be zero once net income has been transferred.
create or replace function public.verify_balance_sheet(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_cons_group uuid default null,
  p_posting_levels text[] default array['00', '01'])
returns table (
  entity_id uuid, entity_code text, entity_name text, currency text,
  total_assets numeric, total_liabilities_equity numeric,
  difference numeric, is_balanced boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.id, e.code, e.name, e.local_currency::text,
         coalesce(sum(f.amount_lc) filter (where a.account_class = 'ASSET'), 0),
         -coalesce(sum(f.amount_lc) filter (where a.account_class in ('LIABILITY','EQUITY')), 0),
         coalesce(sum(f.amount_lc) filter (where a.account_class in ('ASSET','LIABILITY','EQUITY')), 0),
         coalesce(sum(f.amount_lc) filter (where a.account_class in ('ASSET','LIABILITY','EQUITY')), 0) = 0
    from fact_balances f
    join dim_entity  e on e.id = f.entity_id
    join dim_account a on a.id = f.account_id
   where f.tenant_id = current_tenant_id()
     and f.version_id = p_version
     and f.fiscal_year = p_year
     and f.period = p_period
     and f.posting_level = any(p_posting_levels)
     and (p_cons_group is null or f.cons_group_id is not distinct from p_cons_group)
     and a.statement_type in ('BS', 'OCI')
   group by e.id, e.code, e.name, e.local_currency
   order by e.code;
$function$;

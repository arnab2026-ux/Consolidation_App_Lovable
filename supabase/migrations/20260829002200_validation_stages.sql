-- Phase 5: validations have to know where in the close they apply.
--
-- Prompt 18 lists "balance sheet balances to zero" and "net income in the
-- balance sheet equals the P&L total" alongside the dimension checks, as if all
-- of them could be evaluated at the same moment. They cannot, and seeding them
-- that way blocked a perfectly correct close at step 2:
--
--   Balance sheet is out by 3470000.00              (PARENT)
--   Net income in equity 0.00 does not tie to ...   (PARENT)
--
-- Both were true and both were meaningless. Net income is transferred to equity
-- at step 4, so before that the balance sheet is *supposed* to be out by
-- exactly the result, and the equity line is *supposed* to be zero.
--
-- The invariant that does hold on reported data is the one the upload screen
-- already checks: the whole trial balance, balance sheet and P&L together, sums
-- to zero. That becomes the reported-stage check; the other two move to the
-- stage where they are true.
--
--   REPORTED          uploaded data, before any engine has run
--   POST_NET_INCOME   after the result has been taken to equity
--   CONSOLIDATED      after elimination and consolidation of investments

alter table public.validation_rule
  add column if not exists stage text not null default 'REPORTED';

alter table public.validation_rule drop constraint if exists validation_rule_stage_check;
alter table public.validation_rule add constraint validation_rule_stage_check
  check (stage in ('REPORTED', 'POST_NET_INCOME', 'CONSOLIDATED'));

comment on column public.validation_rule.stage is
  'Point in the close at which this rule is meaningful. Checking a rule before '
  'its stage produces true-but-meaningless failures.';

-- ------------------------------------------------------------------ engine
create or replace function public.run_validations(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_levels text[] default array['00','01'],
  p_cons_group uuid default null,
  p_entity uuid default null,
  p_stage text default null)
returns table (
  rule_code text, rule_name text, rule_type text, severity text, is_blocking boolean,
  entity_code text, account_code text, detail text, amount numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_rule record;
  v_check text;
  v_tolerance numeric;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;

  for v_rule in
    select * from validation_rule
     where tenant_id = v_tenant and coalesce(is_active, true)
       and (p_stage is null or stage = p_stage)
     order by sequence nulls last, code
  loop
    v_check := coalesce(v_rule.expression->>'check', v_rule.code);
    v_tolerance := coalesce((v_rule.expression->>'tolerance')::numeric, 0);

    -- The invariant that holds on reported data: every posted line, balance
    -- sheet and profit and loss together, nets to zero for the entity.
    if v_check = 'TB_BALANCES' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, null::text,
               format('Trial balance is out by %s', round(sum(f.amount_lc), 2)),
               round(sum(f.amount_lc), 2)
          from fact_balances f
          join dim_entity e on e.id = f.entity_id
         where f.tenant_id = v_tenant and f.version_id = p_version
           and f.fiscal_year = p_year and f.period = p_period
           and f.posting_level = any(p_levels)
           and (p_entity is null or f.entity_id = p_entity)
         group by e.code
        having abs(round(sum(f.amount_lc), 2)) > v_tolerance;

    elsif v_check = 'BS_BALANCES' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, null::text,
               format('Balance sheet is out by %s', round(sum(f.amount_lc), 2)),
               round(sum(f.amount_lc), 2)
          from fact_balances f
          join dim_entity e on e.id = f.entity_id
          join dim_account a on a.id = f.account_id
         where f.tenant_id = v_tenant and f.version_id = p_version
           and f.fiscal_year = p_year and f.period = p_period
           and f.posting_level = any(p_levels)
           and (p_entity is null or f.entity_id = p_entity)
           and a.statement_type in ('BS', 'OCI')
         group by e.code
        having abs(round(sum(f.amount_lc), 2)) > v_tolerance;

    elsif v_check = 'NET_INCOME_TIES' then
      return query
        with per_entity as (
          select e.code as entity_code,
                 sum(f.amount_lc) filter (where a.is_net_income) as equity_ni,
                 sum(f.amount_lc) filter (where a.statement_type = 'PL') as pl_total
            from fact_balances f
            join dim_entity e on e.id = f.entity_id
            join dim_account a on a.id = f.account_id
           where f.tenant_id = v_tenant and f.version_id = p_version
             and f.fiscal_year = p_year and f.period = p_period
             and f.posting_level = any(p_levels)
             and (p_entity is null or f.entity_id = p_entity)
           group by e.code
        )
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               p.entity_code, null::text,
               format('Net income in equity %s does not tie to the profit and loss result %s',
                      round(coalesce(p.equity_ni, 0), 2), round(coalesce(p.pl_total, 0), 2)),
               round(coalesce(p.equity_ni, 0) - coalesce(p.pl_total, 0), 2)
          from per_entity p
         where coalesce(p.pl_total, 0) <> 0
           and abs(round(coalesce(p.equity_ni, 0) - coalesce(p.pl_total, 0), 2)) > v_tolerance;

    elsif v_check = 'PARTNER_REQUIRED' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, a.code, 'Account requires a partner but none is set',
               round(sum(f.amount_lc), 2)
          from fact_balances f
          join dim_entity e on e.id = f.entity_id
          join dim_account a on a.id = f.account_id
         where f.tenant_id = v_tenant and f.version_id = p_version
           and f.fiscal_year = p_year and f.period = p_period
           and f.posting_level = any(p_levels)
           and (p_entity is null or f.entity_id = p_entity)
           and a.requires_partner and f.partner_id is null and f.amount_lc <> 0
         group by e.code, a.code;

    elsif v_check = 'PARTNER_NOT_SELF' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, a.code, 'Partner is the same entity as the posting entity',
               round(sum(f.amount_lc), 2)
          from fact_balances f
          join dim_entity e on e.id = f.entity_id
          join dim_account a on a.id = f.account_id
         where f.tenant_id = v_tenant and f.version_id = p_version
           and f.fiscal_year = p_year and f.period = p_period
           and f.posting_level = any(p_levels)
           and (p_entity is null or f.entity_id = p_entity)
           and f.partner_id = f.entity_id
         group by e.code, a.code;

    elsif v_check = 'MOVEMENT_REQUIRED' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, a.code, 'Account is movement managed but no movement type is set',
               round(sum(f.amount_lc), 2)
          from fact_balances f
          join dim_entity e on e.id = f.entity_id
          join dim_account a on a.id = f.account_id
         where f.tenant_id = v_tenant and f.version_id = p_version
           and f.fiscal_year = p_year and f.period = p_period
           and f.posting_level = any(p_levels)
           and (p_entity is null or f.entity_id = p_entity)
           and a.requires_movement and f.movement_id is null and f.amount_lc <> 0
         group by e.code, a.code;

    elsif v_check = 'GROUP_SHARE_RANGE' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               e.code, null::text,
               format('Group share of %s is outside 0 to 100', m.group_share_pct),
               m.group_share_pct
          from cons_group_member m
          join dim_entity e on e.id = m.entity_id
         where m.tenant_id = v_tenant
           and (p_cons_group is null or m.cons_group_id = p_cons_group)
           and (m.group_share_pct < 0 or m.group_share_pct > 100);

    elsif v_check = 'FX_COVERAGE' then
      return query
        select v_rule.code, v_rule.name, v_rule.rule_type, v_rule.severity, v_rule.is_blocking,
               c.entity_code, null::text,
               format('No %s rate for %s to %s', c.rate_type, c.from_currency, c.to_currency),
               null::numeric
          from check_fx_coverage(p_version, p_year, p_period, p_cons_group) c
         where p_cons_group is not null and not c.is_present;
    end if;
  end loop;
end
$function$;

-- ---------------------------------------------------------------- defaults
create or replace function public.seed_validation_rules()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_n int;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;

  insert into validation_rule (tenant_id, code, name, rule_type, expression,
                               severity, is_blocking, stage, sequence)
  values
    (v_tenant, 'VAL_TB_BALANCES', 'Trial balance nets to zero', 'BALANCE_CHECK',
     '{"check":"TB_BALANCES","tolerance":0}'::jsonb, 'ERROR', true, 'REPORTED', 10),
    (v_tenant, 'VAL_PARTNER_REQ', 'Intercompany accounts carry a partner', 'DIMENSION_CHECK',
     '{"check":"PARTNER_REQUIRED"}'::jsonb, 'ERROR', true, 'REPORTED', 20),
    (v_tenant, 'VAL_PARTNER_SELF', 'Partner is not the posting entity', 'DIMENSION_CHECK',
     '{"check":"PARTNER_NOT_SELF"}'::jsonb, 'ERROR', true, 'REPORTED', 30),
    (v_tenant, 'VAL_MOVEMENT_REQ', 'Movement-managed accounts carry a movement type', 'DIMENSION_CHECK',
     '{"check":"MOVEMENT_REQUIRED"}'::jsonb, 'WARNING', false, 'REPORTED', 40),
    (v_tenant, 'VAL_GROUP_SHARE', 'Group share is between 0 and 100', 'RANGE_CHECK',
     '{"check":"GROUP_SHARE_RANGE"}'::jsonb, 'ERROR', true, 'REPORTED', 50),
    (v_tenant, 'VAL_FX_COVERAGE', 'Every required exchange rate is on file', 'RANGE_CHECK',
     '{"check":"FX_COVERAGE"}'::jsonb, 'WARNING', false, 'REPORTED', 60),
    (v_tenant, 'VAL_BS_BALANCES', 'Balance sheet balances to zero', 'BALANCE_CHECK',
     '{"check":"BS_BALANCES","tolerance":0}'::jsonb, 'ERROR', true, 'POST_NET_INCOME', 70),
    (v_tenant, 'VAL_NET_INCOME', 'Net income in equity ties to profit and loss', 'ACCOUNT_RELATION',
     '{"check":"NET_INCOME_TIES","tolerance":0}'::jsonb, 'ERROR', true, 'POST_NET_INCOME', 80),
    (v_tenant, 'VAL_CONS_BALANCES', 'Consolidated balance sheet balances to zero', 'BALANCE_CHECK',
     '{"check":"BS_BALANCES","tolerance":0}'::jsonb, 'ERROR', true, 'CONSOLIDATED', 90)
  on conflict (tenant_id, code) do update
    set name = excluded.name, expression = excluded.expression,
        stage = excluded.stage, severity = excluded.severity,
        is_blocking = excluded.is_blocking, sequence = excluded.sequence;

  select count(*) into v_n from validation_rule where tenant_id = v_tenant;
  return v_n;
end
$function$;

-- The workflow's validation step only runs the reported-stage rules.
create or replace function public.run_workflow_validation(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_entity uuid,
  p_cons_group uuid, p_year integer, p_period integer,
  p_stage text default 'REPORTED',
  p_levels text[] default array['00','01'])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_findings jsonb;
  v_errors int;
  v_warnings int;
begin
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb),
         count(*) filter (where v.severity = 'ERROR' and v.is_blocking),
         count(*) filter (where v.severity = 'WARNING' or not v.is_blocking)
    into v_findings, v_errors, v_warnings
    from run_validations(p_version, p_year, p_period, p_levels,
                         p_cons_group, p_entity, p_stage) v;

  update task_run set log = v_findings where id = p_task_run_id;

  return jsonb_build_object(
    'findings', v_findings,
    'errors', coalesce(v_errors, 0),
    'warnings', coalesce(v_warnings, 0),
    'status', case when coalesce(v_errors, 0) > 0 then 'ERROR'
                   when coalesce(v_warnings, 0) > 0 then 'WARNING'
                   else 'SUCCESS' end,
    'message', case
      when coalesce(v_errors, 0) > 0 then format('%s blocking validation failure(s)', v_errors)
      when coalesce(v_warnings, 0) > 0 then format('%s validation warning(s)', v_warnings)
    end);
end
$function$;

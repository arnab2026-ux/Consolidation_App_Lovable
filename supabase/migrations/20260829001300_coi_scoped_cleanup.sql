-- Phase 2: scope the consolidation-of-investments cleanup to its own document.
--
-- run_coi_entity cleared prior rows with
--     entity_id in (p_investee, v_investor)
-- which breaks as soon as one investor holds more than one investee - the
-- ordinary case. PARENT is the investor for all four investees in the demo, so
-- each investee's run deleted the goodwill and investment-reversal rows earlier
-- runs had posted against PARENT. Each entry still balanced when measured on
-- its own, so the function reported a zero residual while the consolidated
-- balance sheet was left out by millions. Only caught by footing the group.
--
-- fact_balances.journal_id cascades from journal_header, so deleting this
-- investee's own COI document is sufficient and cannot reach another's rows.

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

  select * into v_reg
    from investment_register
   where tenant_id = p_tenant and cons_group_id = p_cons_group
     and investee_entity_id = p_investee and fiscal_year = p_year and period = p_period
   order by id limit 1;

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

    -- Goodwill: cost plus fair value adjustments, less the group's share of the
    -- net assets acquired. Frozen from the register when it is there; otherwise
    -- derived from current net assets, which is the first-consolidation case.
    v_goodwill := round(v_investment + v_fva - v_gs * v_na_acquired, 2);

    -- Non-controlling interests. PROPORTIONATE recognises none: the minority
    -- portion was reduced away rather than presented as an interest in equity.
    if v_member.cons_method = 'PURCHASE' and v_mi > 0 then
      if coalesce(v_reg.nci_measurement, 'PROPORTIONATE') = 'FULL_GOODWILL' then
        -- Grossing the goodwill up to 100% reduces to this closed form.
        v_nci := round(v_mi * v_investment / nullif(v_gs, 0), 2);
      else
        v_nci := round(v_mi * v_net_assets, 2);
      end if;

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
     where a.tenant_id = p_tenant and a.is_retained_earnings limit 1;
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
    'nci_equity_gc'     , v_nci,
    'nci_pl_gc'         , round(v_mi * v_net_income, 2),
    'equity_pickup_gc'  , v_pickup,
    'residual_gc'       , v_plug,
    'rows_written'      , v_rows);
end
$function$;

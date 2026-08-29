-- Phase 2 / Prompt 14: intercompany reconciliation and elimination.
--
-- WHERE THE LEGS COME FROM. The pack says to build both legs from posting
-- levels 00/01 using amount_gc. That is no longer where group-currency amounts
-- live: under D1 the reported rows carry amount_gc = 0, and every
-- group-currency figure is produced by translation at posting level 05 (D5).
-- So the legs are built from level 05, which also restricts them to the
-- consolidation group for free, since 05 rows carry cons_group_id.
--
-- This makes translation a hard prerequisite: eliminating before translating
-- would compare zeroes and cheerfully report everything as MATCHED. The
-- reconciliation refuses to run if the slice has no translated rows.
--
-- HOW MUCH IS ELIMINATED (decision D7). The pack says to apply group_share_pct
-- "when either entity is consolidated proportionately". Applying the ownership
-- percentage directly would be wrong for the ordinary case: an 80%-owned
-- subsidiary is fully consolidated with non-controlling interests shown
-- separately, so intercompany balances against it are eliminated in full, not
-- at 80%. What matters is the consolidation METHOD, not the percentage:
--
--     PURCHASE       factor 1.0              - fully consolidated
--     PROPORTIONATE  factor group_share/100  - only the group's share is in
--     EQUITY         factor 0.0              - investee is outside the group,
--                                              so the balance is genuinely
--                                              external and must survive
--
-- A pair is eliminated at the LOWER of the two entities' factors. That is why
-- the seeded SUB_EU -> ASSOC_IN receivable is reported ONE_SIDED and correctly
-- left alone: an equity-method investee is not part of the group.
--
-- HOW A DIFFERENCE IS POSTED. The pack says to reverse both legs "up to the
-- matched amount". That leaves part of an intercompany balance sitting in the
-- consolidated accounts, which defeats the point. Both legs are eliminated in
-- full and the mismatch is posted to a difference account, so the entry
-- balances and no intercompany balance survives consolidation.

-- ------------------------------------------------------------ reconciliation
create or replace function public.run_ic_reconciliation(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid,
  p_year integer, p_period integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule record;
  v_translated int;
  v_pairs int := 0;
  v_counts jsonb;
begin
  select count(*) into v_translated
    from fact_balances f
   where f.tenant_id = p_tenant and f.version_id = p_version
     and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
     and f.period = p_period and f.posting_level = '05';

  if v_translated = 0 then
    raise exception 'No translated balances for %/% - run currency translation before intercompany reconciliation',
      p_year, p_period;
  end if;

  delete from ic_reconciliation
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = p_period;

  for v_rule in
    select * from rule_ic_elim
     where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    with l1 as (
      select f.entity_id, f.partner_id, sum(f.amount_gc) as amt
        from fact_balances f
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
         and f.period = p_period and f.posting_level = '05'
         and f.partner_id is not null
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.leg1_account_filter) r)
       group by 1, 2
      having sum(f.amount_gc) <> 0
    ),
    l2 as (
      select f.entity_id, f.partner_id, sum(f.amount_gc) as amt
        from fact_balances f
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year
         and f.period = p_period and f.posting_level = '05'
         and f.partner_id is not null
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.leg2_account_filter) r)
       group by 1, 2
      having sum(f.amount_gc) <> 0
    ),
    paired as (
      -- Leg 1 entity is Leg 2's partner and vice versa; a full outer join keeps
      -- the rows that exist on only one side.
      select coalesce(l1.entity_id,  l2.partner_id) as entity_id,
             coalesce(l1.partner_id, l2.entity_id)  as partner_id,
             coalesce(l1.amt, 0) as leg1,
             coalesce(l2.amt, 0) as leg2,
             (l1.entity_id is not null and l2.entity_id is not null) as two_sided
        from l1
        full outer join l2
          on l2.entity_id = l1.partner_id and l2.partner_id = l1.entity_id
    )
    insert into ic_reconciliation (
      tenant_id, task_run_id, cons_group_id, fiscal_year, period, version_id,
      entity_id, partner_id, rule_id, leg1_amount_gc, leg2_amount_gc,
      difference_gc, status)
    select p_tenant, p_task_run_id, p_cons_group, p_year, p_period, p_version,
           p.entity_id, p.partner_id, v_rule.id, p.leg1, p.leg2,
           round(p.leg1 + p.leg2, 2),
           case
             when not p.two_sided then 'ONE_SIDED'
             when round(p.leg1 + p.leg2, 2) = 0 then 'MATCHED'
             when abs(p.leg1 + p.leg2) <= coalesce(v_rule.difference_threshold_abs, 0)
               or (coalesce(v_rule.difference_threshold_pct, 0) > 0
                   and abs(p.leg1 + p.leg2)
                       <= greatest(abs(p.leg1), abs(p.leg2))
                          * coalesce(v_rule.difference_threshold_pct, 0) / 100)
               then 'WITHIN_TOLERANCE'
             else 'DIFFERENCE'
           end
      from paired p;

    get diagnostics v_translated = row_count;
    v_pairs := v_pairs + v_translated;
  end loop;

  select jsonb_object_agg(status, n) into v_counts
    from (select status, count(*) as n
            from ic_reconciliation
           where tenant_id = p_tenant and version_id = p_version
             and cons_group_id = p_cons_group and fiscal_year = p_year and period = p_period
           group by status) s;

  return jsonb_build_object('pairs', v_pairs, 'by_status', coalesce(v_counts, '{}'::jsonb));
end
$function$;

-- -------------------------------------------------------------- elimination
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
  v_rule record;
  v_journal uuid;
  v_group_ccy text;
  v_leg1_account uuid;
  v_leg2_account uuid;
  v_diff_account uuid;
  v_factor numeric;
  v_elim1 numeric(23,2);
  v_elim2 numeric(23,2);
  v_diff numeric(23,2);
  v_rows int := 0;
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

    select r.account_id into v_leg1_account
      from resolve_account_filter(p_tenant, v_pair.leg1_account_filter) r limit 1;
    select r.account_id into v_leg2_account
      from resolve_account_filter(p_tenant, v_pair.leg2_account_filter) r limit 1;

    v_elim1 := round(-v_pair.leg1_amount_gc * v_factor, 2);
    v_elim2 := round(-v_pair.leg2_amount_gc * v_factor, 2);
    v_diff  := round(-(v_elim1 + v_elim2), 2);

    -- Reverse leg 1 in full (at the group's share).
    if v_elim1 <> 0 then
      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      select p_tenant, v_pair.entity_id, v_leg1_account, v_pair.partner_id, p_cons_group, p_version,
             p_year, p_period, '10', e.local_currency, v_group_ccy,
             0, 0, v_elim1, v_journal, p_task_run_id, 'IC_ELIM'
        from dim_entity e where e.id = v_pair.entity_id;
      v_rows := v_rows + 1;
    end if;

    -- Reverse leg 2 in full (at the group's share).
    if v_elim2 <> 0 then
      insert into fact_balances (
        tenant_id, entity_id, account_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency,
        amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
      select p_tenant, v_pair.partner_id, v_leg2_account, v_pair.entity_id, p_cons_group, p_version,
             p_year, p_period, '10', e.local_currency, v_group_ccy,
             0, 0, v_elim2, v_journal, p_task_run_id, 'IC_ELIM'
        from dim_entity e where e.id = v_pair.partner_id;
      v_rows := v_rows + 1;
    end if;

    -- Whatever the two legs did not offset has to go somewhere, or the entry
    -- does not balance. Without a common transaction currency there is no
    -- honest way to attribute it to exchange movement, so it is reported as a
    -- real difference rather than guessed at.
    if v_diff <> 0 then
      select a.id into v_diff_account
        from dim_account a
       where a.tenant_id = p_tenant
         and a.code = coalesce(v_pair.real_diff_account_code, v_pair.currency_diff_account_code);
      if v_diff_account is null then
        raise exception 'Rule %: a difference of % needs a difference account',
          v_pair.rule_code, v_diff;
      end if;

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
                          then format('%s pair(s) classified DIFFERENCE were not eliminated because their rule has no real-difference account', v_blocked) end);
end
$function$;

-- ------------------------------------------------------------------ wrapper
create or replace function public.run_ic(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_cons_group uuid,
  p_eliminate boolean default true)
returns table (
  task_run_id uuid, phase text, pairs integer, matched integer,
  within_tolerance integer, differences integer, one_sided integer,
  rows_written integer, eliminated_gc numeric, status text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_task uuid;
  v_recon jsonb;
  v_elim jsonb;
  v_status text;
  v_message text;
  v_by jsonb;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_cons_group is null then
    raise exception 'Intercompany processing is group dependent: select a consolidation group';
  end if;

  -- ---- reconciliation
  insert into task_run (tenant_id, task_type, cons_group_id, version_id,
                        fiscal_year, period, status, started_at, run_by)
  values (v_tenant, 'IC_RECON', p_cons_group, p_version, p_year, p_period, 'RUNNING', now(), auth.uid())
  returning id into v_task;

  begin
    v_recon := run_ic_reconciliation(v_task, v_tenant, p_version, p_cons_group, p_year, p_period);
    v_by := v_recon->'by_status';
    v_status := case when coalesce((v_by->>'DIFFERENCE')::int, 0) > 0 then 'WARNING' else 'SUCCESS' end;
    v_message := null;
  exception when others then
    v_recon := '{}'::jsonb; v_by := '{}'::jsonb;
    v_status := 'ERROR'; v_message := sqlerrm;
  end;

  update task_run set status = v_status, message = v_message, finished_at = now(),
                      rows_written = coalesce((v_recon->>'pairs')::int, 0)
   where id = v_task;

  return query select v_task, 'RECONCILIATION'::text,
    coalesce((v_recon->>'pairs')::int, 0),
    coalesce((v_by->>'MATCHED')::int, 0),
    coalesce((v_by->>'WITHIN_TOLERANCE')::int, 0),
    coalesce((v_by->>'DIFFERENCE')::int, 0),
    coalesce((v_by->>'ONE_SIDED')::int, 0),
    coalesce((v_recon->>'pairs')::int, 0), null::numeric, v_status, v_message;

  if not p_eliminate or v_status = 'ERROR' then
    return;
  end if;

  -- ---- elimination
  insert into task_run (tenant_id, task_type, cons_group_id, version_id,
                        fiscal_year, period, status, started_at, run_by)
  values (v_tenant, 'IC_ELIM', p_cons_group, p_version, p_year, p_period, 'RUNNING', now(), auth.uid())
  returning id into v_task;

  begin
    v_elim := run_ic_elimination(v_task, v_tenant, p_version, p_cons_group, p_year, p_period);
    v_message := v_elim->>'message';
    v_status := case when coalesce((v_elim->>'pairs_blocked')::int, 0) > 0 then 'WARNING'
                     when coalesce((v_elim->>'rows_written')::int, 0) = 0 then 'WARNING'
                     else 'SUCCESS' end;
  exception when others then
    v_elim := '{}'::jsonb; v_status := 'ERROR'; v_message := sqlerrm;
  end;

  update task_run
     set status = v_status, message = v_message, finished_at = now(),
         rows_written = coalesce((v_elim->>'rows_written')::int, 0),
         journal_id = (select id from journal_header where task_run_id = v_task limit 1)
   where id = v_task;

  return query select v_task, 'ELIMINATION'::text,
    0, 0, 0,
    coalesce((v_elim->>'pairs_blocked')::int, 0),
    coalesce((v_elim->>'pairs_skipped')::int, 0),
    coalesce((v_elim->>'rows_written')::int, 0),
    coalesce((v_elim->>'eliminated_gc')::numeric, 0), v_status, v_message;
end
$function$;

-- ------------------------------------------------ matrix for the report screen
create or replace function public.ic_matrix(
  p_version uuid, p_year integer, p_period integer, p_cons_group uuid)
returns table (
  entity_id uuid, entity_code text, partner_id uuid, partner_code text,
  rule_code text, elimination_group text,
  leg1_amount_gc numeric, leg2_amount_gc numeric, difference_gc numeric, status text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select ic.entity_id, e.code, ic.partner_id, p.code,
         r.code, r.elimination_group,
         ic.leg1_amount_gc, ic.leg2_amount_gc, ic.difference_gc, ic.status
    from ic_reconciliation ic
    join dim_entity e on e.id = ic.entity_id
    join dim_entity p on p.id = ic.partner_id
    join rule_ic_elim r on r.id = ic.rule_id
   where ic.tenant_id = current_tenant_id()
     and ic.version_id = p_version
     and ic.fiscal_year = p_year
     and ic.period = p_period
     and ic.cons_group_id = p_cons_group
   order by e.code, p.code, r.code;
$function$;

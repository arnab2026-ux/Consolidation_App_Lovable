-- Phase 2 / Prompt 13: currency translation.
--
-- POSTING LEVEL '05' (decision D5).
--
-- D1 settled that translation posts its own rows carrying cons_group_id. That
-- collides with the posting-level guard: 00 and 01 are entity level and must
-- NOT carry a group, while 10/20/30 must - but those mean IC elimination,
-- consolidation of investments and group manual adjustment respectively, and a
-- translation row is none of those.
--
-- Reusing one of them would make every report that slices by posting level
-- lie about where a number came from. So translation gets its own level, '05':
-- group-dependent, sitting between reported data and consolidation entries.
-- It is the honest answer, and posting_level is a free-text char(2) with no
-- check constraint, so nothing else has to change. Reports must include '05'
-- in both the "reported + adjustments" and "fully consolidated" level sets.
--
-- WHAT IT DOES. For each entity in a consolidation group, every reported row
-- (levels 00/01) is re-expressed in the group currency at the rate its account
-- is configured for - closing, average, historical or opening - and posted as
-- a new row with amount_lc = 0 and amount_gc set. Rules are evaluated in
-- sequence and the FIRST matching rule wins for a given account, so an account
-- caught by two rules is translated once, not twice.
--
-- Assets and liabilities move to the closing rate while equity stays frozen at
-- its historical rate, so the translated balance sheet no longer foots. The
-- gap is the cumulative translation adjustment, posted as the balancing figure
-- to the CTA account. That plug IS the answer, not an error.

-- ------------------------------------------------------- posting level 05
create or replace function public.enforce_posting_level()
returns trigger
language plpgsql
as $function$
begin
  if new.posting_level in ('00', '01') then
    if new.entity_id is null then
      raise exception 'Posting level % requires an entity', new.posting_level;
    end if;
    if new.cons_group_id is not null then
      raise exception 'Posting level % must not carry a consolidation group', new.posting_level;
    end if;

  -- 05 currency translation, 10 IC elimination, 20 consolidation of
  -- investments, 30 group manual adjustment: all group dependent.
  elsif new.posting_level in ('05', '10', '20', '30') then
    if new.cons_group_id is null then
      raise exception 'Posting level % requires a consolidation group', new.posting_level;
    end if;
    if new.posting_level = '05' and new.entity_id is null then
      raise exception 'Posting level 05 requires an entity - translation is per entity within a group';
    end if;

  else
    raise exception 'Unknown posting level %', new.posting_level;
  end if;

  if new.partner_id is not null and new.partner_id = new.entity_id then
    raise exception 'Partner must not equal the entity on a balance row';
  end if;

  return new;
end
$function$;

create or replace function public.enforce_journal_posting_level()
returns trigger
language plpgsql
as $function$
begin
  if new.posting_level in ('00', '01') and new.cons_group_id is not null then
    raise exception 'Posting level % must not carry a consolidation group', new.posting_level;
  end if;
  if new.posting_level in ('05', '10', '20', '30') and new.cons_group_id is null then
    raise exception 'Posting level % requires a consolidation group', new.posting_level;
  end if;
  return new;
end
$function$;

alter table public.journal_header drop constraint if exists journal_header_doc_type_check;
alter table public.journal_header add constraint journal_header_doc_type_check
  check (doc_type in ('UPLOAD','MANUAL','BCF','NETINCOME','TRANSLATION',
                      'IC_ELIM','COI','REVERSAL'));

-- --------------------------------------------------------- rate resolution
-- One place that answers "what rate applies to this row", so the engine and
-- the coverage check can never disagree.
create or replace function public.resolve_translation_rate(
  p_tenant uuid, p_version uuid, p_entity uuid, p_account uuid, p_movement uuid,
  p_rate_type text, p_from text, p_to text, p_year integer, p_period integer)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rate numeric;
  v_acq_year int;
  v_type text := p_rate_type;
begin
  if p_from = p_to then
    return 1;
  end if;

  if v_type = 'HISTORICAL' then
    -- A rate pinned for this entity/account (optionally movement) wins.
    select hr.rate into v_rate
      from historical_rate hr
     where hr.tenant_id = p_tenant and hr.entity_id = p_entity
       and hr.account_id = p_account
       and (hr.movement_id is null or hr.movement_id = p_movement)
       and (hr.valid_from_year is null or hr.valid_from_year <= p_year)
     order by hr.valid_from_year desc nulls last,
              (hr.movement_id is not null) desc
     limit 1;
    if v_rate is not null then
      return v_rate;
    end if;

    -- Otherwise the closing rate of the year the entity was acquired.
    select extract(year from e.acquisition_date)::int into v_acq_year
      from dim_entity e where e.id = p_entity;
    if v_acq_year is not null then
      select r.rate into v_rate
        from fx_rate r
       where r.tenant_id = p_tenant and r.rate_type = 'CLOSING'
         and r.from_currency = p_from and r.to_currency = p_to
         and r.fiscal_year = v_acq_year
       order by r.period desc
       limit 1;
      if v_rate is not null then
        return v_rate;
      end if;
    end if;

    -- Nothing pinned and no rate that far back: fall through to closing.
    v_type := 'CLOSING';
  end if;

  select r.rate into v_rate
    from fx_rate r
   where r.tenant_id = p_tenant and r.rate_type = v_type
     and r.from_currency = p_from and r.to_currency = p_to
     and r.fiscal_year = p_year and r.period = p_period
     and (r.version_id is null or r.version_id = p_version)
   order by (r.version_id is not null) desc
   limit 1;

  return v_rate;   -- null means "no rate on file"; the caller reports it
end
$function$;

-- ------------------------------------------------------- coverage checking
-- Lists every currency/rate-type combination the selected scope needs, and
-- whether it is on file. The screen blocks the run while anything is missing,
-- because a half-translated group is worse than an untranslated one.
create or replace function public.check_fx_coverage(
  p_version uuid, p_year integer, p_period integer, p_cons_group uuid)
returns table (
  entity_code text, from_currency text, to_currency text,
  rate_type text, rate numeric, is_present boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with scope as (
    select e.code, e.local_currency::text as lc, g.group_currency::text as gc
      from cons_group_member m
      join dim_entity e on e.id = m.entity_id
      join dim_cons_group g on g.id = m.cons_group_id
     where m.tenant_id = current_tenant_id()
       and m.cons_group_id = p_cons_group
       and m.cons_method <> 'NONE'
  ),
  needed as (
    select s.code, s.lc, s.gc, t.rate_type
      from scope s
      cross join (values ('CLOSING'), ('AVERAGE')) as t(rate_type)
     where s.lc <> s.gc
  )
  select n.code, n.lc, n.gc, n.rate_type, r.rate, r.rate is not null
    from needed n
    left join fx_rate r
      on r.tenant_id = current_tenant_id()
     and r.rate_type = n.rate_type
     and r.from_currency = n.lc and r.to_currency = n.gc
     and r.fiscal_year = p_year and r.period = p_period
     and (r.version_id is null or r.version_id = p_version)
   order by n.code, n.rate_type;
$function$;

-- ------------------------------------------------------------ entity worker
create or replace function public.run_currency_translation_entity(
  p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid,
  p_entity uuid, p_year integer, p_period integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule record;
  v_missing record;
  v_journal uuid;
  v_entity_ccy text;
  v_group_ccy text;
  v_entity_code text;
  v_cta_account uuid;
  v_cta_code text;
  v_cta_requires_movement boolean;
  v_cta_movement uuid;
  v_cta numeric(23,2);
  v_rows int := 0;
  v_total_lc numeric(23,2);
  v_total_gc numeric(23,2);
begin
  perform assert_period_open(p_tenant, p_version, p_year, p_period, p_cons_group);

  select e.local_currency::text, e.code into v_entity_ccy, v_entity_code
    from dim_entity e where e.id = p_entity and e.tenant_id = p_tenant;
  select g.group_currency::text into v_group_ccy
    from dim_cons_group g where g.id = p_cons_group and g.tenant_id = p_tenant;
  if v_entity_ccy is null or v_group_ccy is null then
    raise exception 'Entity or consolidation group not found';
  end if;

  -- Which rule owns which account. Rules run in sequence and the first match
  -- wins, so an account caught by two rules is translated once.
  create temporary table if not exists _tr_map (
    account_id uuid primary key, rate_type text, rule_code text
  ) on commit drop;
  delete from _tr_map;

  for v_rule in
    select * from rule_translation
     where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    insert into _tr_map (account_id, rate_type, rule_code)
    select r.account_id, v_rule.rate_type, v_rule.code
      from resolve_account_filter(p_tenant, v_rule.account_filter) r
    on conflict (account_id) do nothing;
  end loop;

  if not exists (select 1 from _tr_map) then
    return jsonb_build_object('rows_written', 0, 'cta_gc', 0,
                              'total_lc', 0, 'total_gc', 0,
                              'message', 'No active translation rules matched any account');
  end if;

  -- Fail loudly and early on a missing rate rather than posting a partial,
  -- silently wrong translation.
  if v_entity_ccy <> v_group_ccy then
    for v_missing in
      select distinct m.rate_type from _tr_map m where m.rate_type <> 'HISTORICAL'
    loop
      if not exists (
        select 1 from fx_rate r
         where r.tenant_id = p_tenant and r.rate_type = v_missing.rate_type
           and r.from_currency = v_entity_ccy and r.to_currency = v_group_ccy
           and r.fiscal_year = p_year and r.period = p_period
           and (r.version_id is null or r.version_id = p_version))
      then
        raise exception 'No % rate for %->% at %/% (entity %)',
          v_missing.rate_type, v_entity_ccy, v_group_ccy, p_year, p_period, v_entity_code;
      end if;
    end loop;
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and cons_group_id = p_cons_group and fiscal_year = p_year and period = p_period
     and source_task = 'TRANSLATION' and posting_level = '05';

  delete from journal_header
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and cons_group_id = p_cons_group and fiscal_year = p_year and period = p_period
     and doc_type = 'TRANSLATION';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, entity_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'TRANSLATION', '05', p_year, p_period, p_version, p_entity, p_cons_group,
          p_task_run_id, format('Translation %s %s->%s %s/%s',
                                v_entity_code, v_entity_ccy, v_group_ccy, p_year, p_period))
  returning id into v_journal;

  -- Translate every reported row one-for-one, preserving movement, partner and
  -- custom dimensions so drill-through from a group figure still lands on the
  -- reported detail it came from.
  insert into fact_balances (
    tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
    fiscal_year, period, posting_level,
    zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency,
    amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
  select p_tenant, f.entity_id, f.account_id, f.movement_id, f.partner_id, p_cons_group,
         p_version, p_year, p_period, '05',
         f.zdim01, f.zdim02, f.zdim03, f.zdim04, f.zdim05,
         f.zdim06, f.zdim07, f.zdim08, f.zdim09, f.zdim10,
         f.transaction_currency, f.local_currency, v_group_ccy,
         0, 0,
         round(f.amount_lc * resolve_translation_rate(
                 p_tenant, p_version, f.entity_id, f.account_id, f.movement_id,
                 m.rate_type, v_entity_ccy, v_group_ccy, p_year, p_period), 2),
         v_journal, p_task_run_id, 'TRANSLATION'
    from fact_balances f
    join _tr_map m on m.account_id = f.account_id
   where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
     and f.cons_group_id is null and f.fiscal_year = p_year and f.period = p_period
     and f.posting_level in ('00', '01')
     and f.amount_lc <> 0;

  get diagnostics v_rows = row_count;

  -- The cumulative translation adjustment: the figure that makes the
  -- translated balance sheet foot again once equity is held at historical
  -- rates and everything else has moved to closing.
  select -coalesce(sum(f.amount_gc), 0) into v_cta
    from fact_balances f
    join dim_account a on a.id = f.account_id
   where f.task_run_id = p_task_run_id and f.journal_id = v_journal
     and a.statement_type in ('BS', 'OCI');

  if v_cta <> 0 then
    select r.post_difference_to into v_cta_code
      from rule_translation r
     where r.tenant_id = p_tenant and coalesce(r.is_active, true)
       and r.post_difference_to is not null
     order by r.sequence nulls last, r.code
     limit 1;
    if v_cta_code is null then
      raise exception 'Translation difference of % needs a CTA account: set "post difference to" on a rule', v_cta;
    end if;

    select a.id, a.requires_movement into v_cta_account, v_cta_requires_movement
      from dim_account a where a.tenant_id = p_tenant and a.code = v_cta_code;
    if v_cta_account is null then
      raise exception 'CTA account % does not exist', v_cta_code;
    end if;

    if v_cta_requires_movement then
      select mv.id into v_cta_movement from dim_movement mv
       where mv.tenant_id = p_tenant and mv.movement_class = 'FX_EFFECT'
       order by mv.display_order nulls last, mv.code limit 1;
    end if;

    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    values (p_tenant, p_entity, v_cta_account, v_cta_movement, p_cons_group, p_version,
            p_year, p_period, '05', v_entity_ccy, v_group_ccy,
            0, 0, v_cta, v_journal, p_task_run_id, 'TRANSLATION');
    v_rows := v_rows + 1;
  end if;

  select coalesce(sum(f.amount_lc), 0) into v_total_lc
    from fact_balances f
   where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
     and f.cons_group_id is null and f.fiscal_year = p_year and f.period = p_period
     and f.posting_level in ('00', '01');

  select coalesce(sum(f.amount_gc), 0) into v_total_gc
    from fact_balances f
   where f.task_run_id = p_task_run_id and f.journal_id = v_journal;

  return jsonb_build_object(
    'rows_written', v_rows,
    'cta_gc'      , v_cta,
    'total_lc'    , v_total_lc,
    'total_gc'    , v_total_gc);
end
$function$;

-- ------------------------------------------------------------------ wrapper
create or replace function public.run_currency_translation(
  p_version uuid,
  p_year integer,
  p_period integer,
  p_cons_group uuid,
  p_entities uuid[] default '{}'::uuid[])
returns table (
  task_run_id uuid, entity_id uuid, entity_code text, entity_name text,
  local_currency text, group_currency text,
  closing_rate numeric, average_rate numeric,
  total_lc numeric, total_gc numeric, cta_gc numeric,
  rows_written integer, status text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_group_ccy text;
  v_entity record;
  v_task uuid;
  v_result jsonb;
  v_rows int;
  v_status text;
  v_message text;
  v_cta numeric;
  v_lc numeric;
  v_gc numeric;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_version is null or p_year is null or p_period is null then
    raise exception 'Version, fiscal year and period are required';
  end if;
  if p_cons_group is null then
    raise exception 'Translation is group dependent: select a consolidation group';
  end if;

  select g.group_currency::text into v_group_ccy
    from dim_cons_group g where g.id = p_cons_group and g.tenant_id = v_tenant;
  if v_group_ccy is null then raise exception 'Consolidation group not found'; end if;

  for v_entity in
    select e.id, e.code, e.name, e.local_currency::text as lc
      from cons_group_member m
      join dim_entity e on e.id = m.entity_id
     where m.tenant_id = v_tenant and m.cons_group_id = p_cons_group
       and m.cons_method <> 'NONE'
       and (coalesce(array_length(p_entities, 1), 0) = 0 or e.id = any(p_entities))
     order by e.code
  loop
    insert into task_run (tenant_id, task_type, entity_id, cons_group_id, version_id,
                          fiscal_year, period, status, started_at, run_by)
    values (v_tenant, 'TRANSLATION', v_entity.id, p_cons_group, p_version,
            p_year, p_period, 'RUNNING', now(), auth.uid())
    returning id into v_task;

    begin
      v_result := run_currency_translation_entity(
        v_task, v_tenant, p_version, p_cons_group, v_entity.id, p_year, p_period);
      v_rows := (v_result->>'rows_written')::int;
      v_cta  := (v_result->>'cta_gc')::numeric;
      v_lc   := (v_result->>'total_lc')::numeric;
      v_gc   := (v_result->>'total_gc')::numeric;
      v_status := case when v_rows = 0 then 'WARNING' else 'SUCCESS' end;
      v_message := v_result->>'message';
    exception when others then
      v_rows := 0; v_cta := null; v_lc := null; v_gc := null;
      v_status := 'ERROR'; v_message := sqlerrm;
    end;

    update task_run
       set status = v_status, rows_written = v_rows, message = v_message, finished_at = now(),
           journal_id = (select id from journal_header where task_run_id = v_task limit 1)
     where id = v_task;

    return query
      select v_task, v_entity.id, v_entity.code, v_entity.name,
             v_entity.lc, v_group_ccy,
             resolve_translation_rate(v_tenant, p_version, v_entity.id, null, null,
                                      'CLOSING', v_entity.lc, v_group_ccy, p_year, p_period),
             resolve_translation_rate(v_tenant, p_version, v_entity.id, null, null,
                                      'AVERAGE', v_entity.lc, v_group_ccy, p_year, p_period),
             v_lc, v_gc, v_cta, v_rows, v_status, v_message;
  end loop;
end
$function$;

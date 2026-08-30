-- Currency translation failed for every entity with "DELETE requires a WHERE
-- clause".
--
-- Supabase preloads pg_safeupdate for the 'authenticated' role, which rejects
-- any DELETE or UPDATE that has no WHERE clause. run_currency_translation_entity
-- cleared its per-run temporary account/rate map with a bare
--
--     delete from _tr_map;
--
-- which the extension refuses even though the target is a temporary table the
-- function created moments earlier.
--
-- This was invisible to every test so far: the migration and verification
-- scripts connect as the pooler superuser, for which the library is not
-- preloaded, so the same close ran clean from SQL and failed in the app. It is
-- the only unqualified DELETE or UPDATE in the schema - the rest were checked.
--
-- TRUNCATE is not guarded by pg_safeupdate, and is the better operation for
-- emptying a temporary table regardless.

CREATE OR REPLACE FUNCTION public.run_currency_translation_entity(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid, p_entity uuid, p_year integer, p_period integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_unmapped text;
  v_unmapped_count int := 0;
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
  -- TRUNCATE, not DELETE. Supabase preloads pg_safeupdate for the
  -- 'authenticated' role, which refuses any DELETE or UPDATE without a WHERE
  -- clause - including on a temporary table - with "DELETE requires a WHERE
  -- clause". TRUNCATE is not guarded, and is the right operation here anyway.
  truncate _tr_map;

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


  -- Accounts carrying a balance that no rule claims. Without this the CTA
  -- silently absorbs them and reports a plausible, wrong number - which is
  -- exactly what happened to "Net income for the period" (BS + AVERAGE), an
  -- account that matched neither the BS/CLOSING rule nor the PL rule.
  -- translation_method = 'NONE' is deliberate non-translation (the CTA account
  -- itself), so it is not a gap.
  select count(*), string_agg(a.code || ' ' || a.name, ', ' order by a.code)
    into v_unmapped_count, v_unmapped
    from (select distinct f.account_id
            from fact_balances f
           where f.tenant_id = p_tenant and f.version_id = p_version
             and f.entity_id = p_entity and f.cons_group_id is null
             and f.fiscal_year = p_year and f.period = p_period
             and f.posting_level in ('00', '01') and f.amount_lc <> 0) s
    join dim_account a on a.id = s.account_id
   where a.translation_method <> 'NONE'
     and not exists (select 1 from _tr_map m where m.account_id = s.account_id);

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
    'rows_written'    , v_rows,
    'cta_gc'          , v_cta,
    'total_lc'        , v_total_lc,
    'total_gc'        , v_total_gc,
    'unmapped_count'  , v_unmapped_count,
    'unmapped'        , v_unmapped,
    'message'         , case when v_unmapped_count > 0
                          then format('%s account(s) carry a balance but no translation rule claims them, so the CTA absorbed them: %s',
                                      v_unmapped_count, v_unmapped) end);
end
$function$
;

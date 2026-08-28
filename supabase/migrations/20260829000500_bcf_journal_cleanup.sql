-- Phase 1: stop Balance Carry Forward orphaning journal headers.
--
-- run_bcf_entity/run_bcf_group delete the prior run's fact rows to stay
-- idempotent, but left the journal_header row behind. fact_balances.journal_id
-- cascades from journal_header, not the other way round, so a second run
-- produced a correct set of balances plus one empty document per run. Only
-- surfaced by re-running BCF twice and counting documents.

CREATE OR REPLACE FUNCTION public.run_bcf_entity(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_entity uuid, p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_entity_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, null);

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
         and f.posting_level in ('00', '01')
         and a.statement_type in ('BS', 'OCI')
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
           and f.posting_level in ('00', '01')
           and a.statement_type = 'PL'
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
$function$
;

CREATE OR REPLACE FUNCTION public.run_bcf_group(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid, p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_group_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, p_cons_group);

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
         and f.posting_level in ('10', '20', '30')
         and a.statement_type in ('BS', 'OCI')
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
           and f.posting_level in ('10', '20', '30') and a.statement_type = 'PL'
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
$function$
;

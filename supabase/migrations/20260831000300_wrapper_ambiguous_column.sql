-- Every "Run" button on the rules screens failed with
--     column reference "task_run_id" is ambiguous
--
-- The five wrapper functions are declared RETURNS TABLE (task_run_id uuid, ...).
-- In plpgsql those output column names are variables in scope for the whole
-- body, so this subquery, which each wrapper uses to attach the document it
-- just wrote to its task_run row,
--
--     (select id from journal_header where task_run_id = v_task limit 1)
--
-- reads task_run_id as both the output variable and journal_header's column.
-- Qualifying it through an alias resolves it to the column.
--
-- run_bcf carried this from the original build, so its Run button had never
-- worked; the other four inherited the pattern when they were written.
--
-- It went unnoticed because every end-to-end test drove the workers
-- (run_bcf_entity, run_ic_elimination, ...) or run_workflow_task, which
-- returns jsonb and has no such output columns. The Consolidation Monitor
-- therefore worked while the per-screen Run buttons did not.

CREATE OR REPLACE FUNCTION public.run_bcf(p_version uuid, p_year integer, p_entities uuid[] DEFAULT '{}'::uuid[], p_groups uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(task_run_id uuid, target_kind text, target_id uuid, target_code text, target_name text, rows_written integer, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_target record;
  v_task uuid;
  v_rows int;
  v_status text;
  v_message text;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_version is null or p_year is null then raise exception 'Version and fiscal year are required'; end if;

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
    insert into task_run(tenant_id, task_type, entity_id, cons_group_id, version_id,
                         fiscal_year, period, status, started_at, run_by)
    values (v_tenant, 'BCF',
            case when v_target.kind = 'ENTITY' then v_target.id end,
            case when v_target.kind = 'GROUP' then v_target.id end,
            p_version, p_year, 0, 'RUNNING', now(), auth.uid())
    returning id into v_task;

    begin
      if v_target.kind = 'ENTITY' then
        v_rows := run_bcf_entity(v_task, v_tenant, p_version, v_target.id, p_year);
      else
        v_rows := run_bcf_group(v_task, v_tenant, p_version, v_target.id, p_year);
      end if;
      v_status := case when v_rows = 0 then 'WARNING' else 'SUCCESS' end;
      v_message := case when v_rows = 0 then 'No source balances matched the active BCF rules' end;
    exception when others then
      v_rows := 0;
      v_status := 'ERROR';
      v_message := sqlerrm;
    end;

    update task_run
       set status = v_status, rows_written = v_rows, message = v_message, finished_at = now(),
           journal_id = (select j.id from journal_header j where j.task_run_id = v_task limit 1)
     where id = v_task;

    return query select v_task, v_target.kind, v_target.id, v_target.code, v_target.name,
                        v_rows, v_status, v_message;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_coi(p_version uuid, p_year integer, p_period integer, p_cons_group uuid, p_entities uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(task_run_id uuid, investee_id uuid, investee_code text, investee_name text, cons_method text, group_share_pct numeric, net_assets_gc numeric, investment_gc numeric, goodwill_gc numeric, nci_equity_gc numeric, nci_pl_gc numeric, equity_pickup_gc numeric, residual_gc numeric, rows_written integer, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_e record;
  v_task uuid;
  v_r jsonb;
  v_status text;
  v_message text;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_cons_group is null then
    raise exception 'Consolidation of investments is group dependent: select a consolidation group';
  end if;

  for v_e in
    select e.id, e.code, e.name, m.cons_method
      from cons_group_member m
      join dim_entity e on e.id = m.entity_id
     where m.tenant_id = v_tenant and m.cons_group_id = p_cons_group
       and m.cons_method <> 'NONE'
       and e.entity_type <> 'PARENT'      -- the parent is not consolidated into itself
       and (coalesce(array_length(p_entities, 1), 0) = 0 or e.id = any(p_entities))
     order by e.code
  loop
    insert into task_run (tenant_id, task_type, entity_id, cons_group_id, version_id,
                          fiscal_year, period, status, started_at, run_by)
    values (v_tenant, 'COI', v_e.id, p_cons_group, p_version, p_year, p_period,
            'RUNNING', now(), auth.uid())
    returning id into v_task;

    begin
      v_r := run_coi_entity(v_task, v_tenant, p_version, p_cons_group, v_e.id, p_year, p_period);
      v_status := case when (v_r->>'rows_written')::int = 0 then 'WARNING' else 'SUCCESS' end;
      v_message := null;
    exception when others then
      v_r := '{}'::jsonb; v_status := 'ERROR'; v_message := sqlerrm;
    end;

    update task_run
       set status = v_status, message = v_message, finished_at = now(),
           rows_written = coalesce((v_r->>'rows_written')::int, 0),
           journal_id = (select j.id from journal_header j where j.task_run_id = v_task limit 1)
     where id = v_task;

    return query select v_task, v_e.id, v_e.code, v_e.name,
      coalesce(v_r->>'method', v_e.cons_method),
      (v_r->>'group_share_pct')::numeric,
      (v_r->>'net_assets_gc')::numeric,
      (v_r->>'investment_gc')::numeric,
      (v_r->>'goodwill_gc')::numeric,
      (v_r->>'nci_equity_gc')::numeric,
      (v_r->>'nci_pl_gc')::numeric,
      (v_r->>'equity_pickup_gc')::numeric,
      (v_r->>'residual_gc')::numeric,
      coalesce((v_r->>'rows_written')::int, 0), v_status, v_message;
  end loop;
end
$function$
;

CREATE OR REPLACE FUNCTION public.run_currency_translation(p_version uuid, p_year integer, p_period integer, p_cons_group uuid, p_entities uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(task_run_id uuid, entity_id uuid, entity_code text, entity_name text, local_currency text, group_currency text, closing_rate numeric, average_rate numeric, total_lc numeric, total_gc numeric, cta_gc numeric, rows_written integer, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           journal_id = (select j.id from journal_header j where j.task_run_id = v_task limit 1)
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
$function$
;

CREATE OR REPLACE FUNCTION public.run_ic(p_version uuid, p_year integer, p_period integer, p_cons_group uuid, p_eliminate boolean DEFAULT true)
 RETURNS TABLE(task_run_id uuid, phase text, pairs integer, matched integer, within_tolerance integer, differences integer, one_sided integer, rows_written integer, eliminated_gc numeric, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         journal_id = (select j.id from journal_header j where j.task_run_id = v_task limit 1)
   where id = v_task;

  return query select v_task, 'ELIMINATION'::text,
    0, 0, 0,
    coalesce((v_elim->>'pairs_blocked')::int, 0),
    coalesce((v_elim->>'pairs_skipped')::int, 0),
    coalesce((v_elim->>'rows_written')::int, 0),
    coalesce((v_elim->>'eliminated_gc')::numeric, 0), v_status, v_message;
end
$function$
;

CREATE OR REPLACE FUNCTION public.run_net_income(p_version uuid, p_year integer, p_period integer, p_entities uuid[] DEFAULT '{}'::uuid[], p_groups uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(task_run_id uuid, target_kind text, target_id uuid, target_code text, target_name text, net_income_lc numeric, net_income_gc numeric, rows_written integer, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           journal_id = (select j.id from journal_header j where j.task_run_id = v_task limit 1)
     where id = v_task;

    return query select v_task, v_target.kind, v_target.id, v_target.code, v_target.name,
                        v_ni_lc, v_ni_gc, v_rows, v_status, v_message;
  end loop;
end
$function$
;

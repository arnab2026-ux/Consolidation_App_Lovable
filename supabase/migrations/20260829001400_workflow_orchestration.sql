-- Phase 3 / Prompt 16: workflow orchestration.
--
-- Decision D2: this runs as Postgres functions driven by the client, not as an
-- Edge Function. Every engine is already an RPC and the run screens already
-- poll task_run, so a per-task RPC plus a dependency-graph driver in React
-- gives live per-cell progress with no deploy pipeline and no second copy of
-- the dependency rules.
--
-- WHY IT MATTERS. The close order is load-bearing, not conventional. Currency
-- translation reads what balance carry forward and entity net income wrote;
-- intercompany reconciliation reads translated balances and refuses to run
-- without them; consolidation of investments reads the same; and group net
-- income has to come last or the group balance sheet does not foot. Until now
-- the only thing enforcing that was whoever was running it.
--
--   start_workflow_run()  materialises the whole grid as PENDING task_run rows
--   workflow_deps_met()   answers "can this cell run yet"
--   run_workflow_task()   checks dependencies, dispatches to the engine
--   workflow_monitor()    returns the grid for the screen

-- ------------------------------------------------- standard close template
create or replace function public.seed_standard_workflow_template()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_template uuid;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;

  insert into workflow_template (tenant_id, code, name, is_active)
  values (v_tenant, 'STD_CLOSE', 'Standard close', true)
  on conflict (tenant_id, code) do update set name = excluded.name
  returning id into v_template;

  delete from workflow_step where template_id = v_template;

  insert into workflow_step (tenant_id, template_id, step_no, task_type, name, scope,
                             is_blocking, requires_approval, depends_on_step_no)
  values
    (v_tenant, v_template,  1, 'DATA_UPLOAD' , 'Data upload'                  , 'ENTITY', true , false, null),
    (v_tenant, v_template,  2, 'VALIDATION'  , 'Validation'                   , 'ENTITY', true , false, array[1]),
    (v_tenant, v_template,  3, 'BCF'         , 'Balance carry forward'        , 'ENTITY', true , false, array[2]),
    (v_tenant, v_template,  4, 'NET_INCOME'  , 'Net income (entity)'          , 'ENTITY', true , false, array[3]),
    (v_tenant, v_template,  5, 'TRANSLATION' , 'Currency translation'         , 'ENTITY', true , false, array[4]),
    (v_tenant, v_template,  6, 'IC_RECON'    , 'Intercompany reconciliation'  , 'GROUP' , false, false, array[5]),
    (v_tenant, v_template,  7, 'IC_ELIM'     , 'Intercompany elimination'     , 'GROUP' , true , false, array[6]),
    (v_tenant, v_template,  8, 'COI'         , 'Consolidation of investments' , 'ENTITY', true , false, array[7]),
    (v_tenant, v_template,  9, 'NET_INCOME'  , 'Net income (group)'           , 'GROUP' , true , false, array[8]),
    (v_tenant, v_template, 10, 'GROUP_REPORT', 'Group reports'                , 'GROUP' , false, false, array[9]),
    (v_tenant, v_template, 11, 'LOCK_PERIOD' , 'Lock period'                  , 'GROUP' , true , true , array[10]);

  return v_template;
end
$function$;

-- ------------------------------------------------------------ materialise
create or replace function public.start_workflow_run(
  p_template uuid, p_version uuid, p_year integer, p_period integer, p_cons_group uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_run uuid;
  v_step record;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_cons_group is null then
    raise exception 'A consolidation group is required to start a close';
  end if;

  -- One run per template and point of view; re-starting reuses it so the grid
  -- keeps its history rather than accumulating parallel runs.
  select id into v_run
    from workflow_run
   where tenant_id = v_tenant and template_id = p_template and version_id = p_version
     and fiscal_year = p_year and period = p_period
     and cons_group_id is not distinct from p_cons_group;

  if v_run is null then
    insert into workflow_run (tenant_id, template_id, cons_group_id, version_id,
                              fiscal_year, period, status, started_at, started_by)
    values (v_tenant, p_template, p_cons_group, p_version, p_year, p_period,
            'NOT_STARTED', now(), auth.uid())
    returning id into v_run;
  end if;

  for v_step in
    select * from workflow_step where template_id = p_template order by step_no
  loop
    if v_step.scope = 'ENTITY' then
      insert into task_run (tenant_id, workflow_run_id, step_id, task_type, entity_id,
                            cons_group_id, version_id, fiscal_year, period, status)
      select v_tenant, v_run, v_step.id, v_step.task_type, e.id, p_cons_group,
             p_version, p_year, p_period, 'PENDING'
        from cons_group_member m
        join dim_entity e on e.id = m.entity_id
       where m.tenant_id = v_tenant and m.cons_group_id = p_cons_group
         and m.cons_method <> 'NONE'
         -- consolidation of investments does not apply to the parent itself
         and (v_step.task_type <> 'COI' or e.entity_type <> 'PARENT')
         and not exists (
           select 1 from task_run t
            where t.workflow_run_id = v_run and t.step_id = v_step.id and t.entity_id = e.id);
    else
      insert into task_run (tenant_id, workflow_run_id, step_id, task_type,
                            cons_group_id, version_id, fiscal_year, period, status)
      select v_tenant, v_run, v_step.id, v_step.task_type, p_cons_group,
             p_version, p_year, p_period, 'PENDING'
       where not exists (
         select 1 from task_run t
          where t.workflow_run_id = v_run and t.step_id = v_step.id and t.entity_id is null);
    end if;
  end loop;

  return v_run;
end
$function$;

-- ------------------------------------------------------------ dependencies
-- Entity step on entity step: the same entity must have succeeded.
-- Entity step on group step: the group task must have succeeded.
-- Group step on entity step: every entity must have succeeded.
create or replace function public.workflow_deps_met(p_task_run_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_task task_run;
  v_step workflow_step;
  v_dep int;
  v_dep_step workflow_step;
  v_outstanding int;
begin
  select * into v_task from task_run where id = p_task_run_id;
  if not found then return false; end if;
  select * into v_step from workflow_step where id = v_task.step_id;
  if not found then return true; end if;

  foreach v_dep in array coalesce(v_step.depends_on_step_no, array[]::int[])
  loop
    select * into v_dep_step
      from workflow_step
     where template_id = v_step.template_id and step_no = v_dep;
    if not found then continue; end if;

    select count(*) into v_outstanding
      from task_run t
     where t.workflow_run_id = v_task.workflow_run_id
       and t.step_id = v_dep_step.id
       and t.status <> 'SUCCESS'
       and (
         -- an entity step waits only on its own entity
         v_step.scope = 'GROUP'
         or v_dep_step.scope = 'GROUP'
         or t.entity_id = v_task.entity_id
       );

    if v_outstanding > 0 then return false; end if;
  end loop;

  return true;
end
$function$;

-- ------------------------------------------------------------- dispatcher
create or replace function public.run_workflow_task(p_task_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_task task_run;
  v_step workflow_step;
  v_result jsonb := '{}'::jsonb;
  v_rows int := 0;
  v_status text := 'SUCCESS';
  v_message text;
  v_n numeric;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;

  select * into v_task from task_run where id = p_task_run_id and tenant_id = v_tenant;
  if not found then raise exception 'Task not found'; end if;
  select * into v_step from workflow_step where id = v_task.step_id;

  if not workflow_deps_met(p_task_run_id) then
    raise exception 'Upstream steps have not completed yet';
  end if;

  update task_run set status = 'RUNNING', started_at = now(), message = null,
                      run_by = auth.uid()
   where id = p_task_run_id;

  begin
    case v_task.task_type

      -- Reported data is loaded by the upload screen; this step confirms it
      -- arrived rather than pretending to load it.
      when 'DATA_UPLOAD' then
        select count(*) into v_rows from fact_balances f
         where f.tenant_id = v_tenant and f.version_id = v_task.version_id
           and f.entity_id = v_task.entity_id and f.cons_group_id is null
           and f.fiscal_year = v_task.fiscal_year and f.period = v_task.period
           and f.posting_level = '00';
        if v_rows = 0 then
          v_status := 'WARNING';
          v_message := 'No reported data for this entity and period';
        end if;

      -- The check the upload screen makes, re-made here so the close cannot
      -- proceed on an entity whose books do not balance.
      when 'VALIDATION' then
        select coalesce(sum(f.amount_lc), 0) into v_n from fact_balances f
         where f.tenant_id = v_tenant and f.version_id = v_task.version_id
           and f.entity_id = v_task.entity_id and f.cons_group_id is null
           and f.fiscal_year = v_task.fiscal_year and f.period = v_task.period
           and f.posting_level in ('00', '01');
        if round(v_n, 2) <> 0 then
          v_status := 'ERROR';
          v_message := format('Trial balance does not sum to zero: %s', round(v_n, 2));
        end if;

      when 'BCF' then
        if v_step.scope = 'ENTITY' then
          v_rows := run_bcf_entity(p_task_run_id, v_tenant, v_task.version_id,
                                   v_task.entity_id, v_task.fiscal_year);
        else
          v_rows := run_bcf_group(p_task_run_id, v_tenant, v_task.version_id,
                                  v_task.cons_group_id, v_task.fiscal_year);
        end if;

      when 'NET_INCOME' then
        if v_step.scope = 'ENTITY' then
          v_result := run_net_income_entity(p_task_run_id, v_tenant, v_task.version_id,
                                            v_task.entity_id, v_task.fiscal_year, v_task.period);
        else
          v_result := run_net_income_group(p_task_run_id, v_tenant, v_task.version_id,
                                           v_task.cons_group_id, v_task.fiscal_year, v_task.period);
        end if;
        v_rows := coalesce((v_result->>'rows_written')::int, 0);

      when 'TRANSLATION' then
        v_result := run_currency_translation_entity(p_task_run_id, v_tenant, v_task.version_id,
                      v_task.cons_group_id, v_task.entity_id, v_task.fiscal_year, v_task.period);
        v_rows := coalesce((v_result->>'rows_written')::int, 0);
        v_message := v_result->>'message';
        if coalesce((v_result->>'unmapped_count')::int, 0) > 0 then v_status := 'WARNING'; end if;

      when 'IC_RECON' then
        v_result := run_ic_reconciliation(p_task_run_id, v_tenant, v_task.version_id,
                      v_task.cons_group_id, v_task.fiscal_year, v_task.period);
        v_rows := coalesce((v_result->>'pairs')::int, 0);
        if coalesce((v_result#>>'{by_status,DIFFERENCE}')::int, 0) > 0 then
          v_status := 'WARNING';
          v_message := format('%s pair(s) out of balance',
                              (v_result#>>'{by_status,DIFFERENCE}')::int);
        end if;

      when 'IC_ELIM' then
        v_result := run_ic_elimination(p_task_run_id, v_tenant, v_task.version_id,
                      v_task.cons_group_id, v_task.fiscal_year, v_task.period);
        v_rows := coalesce((v_result->>'rows_written')::int, 0);
        v_message := v_result->>'message';
        if coalesce((v_result->>'pairs_blocked')::int, 0) > 0 then v_status := 'WARNING'; end if;

      when 'COI' then
        v_result := run_coi_entity(p_task_run_id, v_tenant, v_task.version_id,
                      v_task.cons_group_id, v_task.entity_id, v_task.fiscal_year, v_task.period);
        v_rows := coalesce((v_result->>'rows_written')::int, 0);

      -- Checkpoints rather than engines: they exist so the monitor can show a
      -- human decision was taken at that point in the close.
      when 'MANUAL_ADJ' then
        v_message := 'Checkpoint acknowledged';

      when 'GROUP_REPORT' then
        select count(*) into v_rows from fact_balances f
         where f.tenant_id = v_tenant and f.version_id = v_task.version_id
           and f.cons_group_id = v_task.cons_group_id
           and f.fiscal_year = v_task.fiscal_year and f.period = v_task.period
           and f.posting_level in ('05', '10', '20', '30');

      when 'LOCK_PERIOD' then
        update period_status
           set status = 'LOCKED'
         where tenant_id = v_tenant and version_id = v_task.version_id
           and fiscal_year = v_task.fiscal_year and period = v_task.period
           and cons_group_id is not distinct from v_task.cons_group_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
          insert into period_status (tenant_id, fiscal_year, period, version_id,
                                     cons_group_id, status)
          values (v_tenant, v_task.fiscal_year, v_task.period, v_task.version_id,
                  v_task.cons_group_id, 'LOCKED')
          on conflict (tenant_id, fiscal_year, period, version_id, cons_group_id)
            do update set status = 'LOCKED';
          v_rows := 1;
        end if;

      else
        v_status := 'WARNING';
        v_message := format('No engine is wired up for task type %s', v_task.task_type);
    end case;

  exception when others then
    v_status := 'ERROR';
    v_message := sqlerrm;
    v_rows := 0;
  end;

  update task_run
     set status = v_status, rows_written = v_rows, message = v_message, finished_at = now(),
         journal_id = (select id from journal_header where task_run_id = p_task_run_id limit 1)
   where id = p_task_run_id;

  -- Roll the parent run's headline status up from its tasks.
  update workflow_run w
     set status = case
           when exists (select 1 from task_run t where t.workflow_run_id = w.id and t.status = 'ERROR')
             then 'FAILED'
           when not exists (select 1 from task_run t where t.workflow_run_id = w.id
                             and t.status in ('PENDING', 'RUNNING'))
             then 'COMPLETED'
           else 'RUNNING' end,
         completed_at = case
           when not exists (select 1 from task_run t where t.workflow_run_id = w.id
                             and t.status in ('PENDING', 'RUNNING'))
             then now() end
   where w.id = v_task.workflow_run_id;

  return jsonb_build_object('status', v_status, 'rows_written', v_rows, 'message', v_message);
end
$function$;

-- ------------------------------------------------------------- the grid
create or replace function public.workflow_monitor(p_workflow_run_id uuid)
returns table (
  step_id uuid, step_no integer, step_name text, task_type text, scope text,
  is_blocking boolean, requires_approval boolean,
  unit_kind text, unit_id uuid, unit_code text, unit_name text,
  task_run_id uuid, status text, rows_written integer, message text,
  started_at timestamptz, finished_at timestamptz, deps_met boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, s.step_no, s.name, t.task_type, s.scope,
         s.is_blocking, s.requires_approval,
         case when t.entity_id is null then 'GROUP' else 'ENTITY' end,
         coalesce(t.entity_id, t.cons_group_id),
         coalesce(e.code, g.code),
         coalesce(e.name, g.name),
         t.id, t.status, t.rows_written, t.message, t.started_at, t.finished_at,
         workflow_deps_met(t.id)
    from task_run t
    join workflow_step s on s.id = t.step_id
    left join dim_entity e on e.id = t.entity_id
    left join dim_cons_group g on g.id = t.cons_group_id and t.entity_id is null
   where t.tenant_id = current_tenant_id()
     and t.workflow_run_id = p_workflow_run_id
   order by s.step_no, coalesce(e.code, g.code);
$function$;

-- Phase 5: the close refreshes the pre-aggregated statement slice.
--
-- Prompt 18 asks for a refresh at the end of each workflow run. The Group
-- Reports step is that point: everything that posts has already run, and the
-- step previously only counted rows. It now refreshes mv_cons_totals and
-- reports how long that took, so the cost stays visible.

CREATE OR REPLACE FUNCTION public.run_workflow_task(p_task_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Runs the whole validation rule set and keeps the findings on
      -- task_run.log, which the monitor's detail drawer reads. A blocking
      -- ERROR finding fails the step, so the close stops on bad data instead
      -- of consolidating it.
      when 'VALIDATION' then
        v_result := run_workflow_validation(p_task_run_id, v_tenant, v_task.version_id,
                      v_task.entity_id, v_task.cons_group_id, v_task.fiscal_year, v_task.period);
        v_status := v_result->>'status';
        v_message := v_result->>'message';
        v_rows := jsonb_array_length(coalesce(v_result->'findings', '[]'::jsonb));

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

      -- Refreshes the pre-aggregated statement slice, so the reports reflect
      -- everything this close posted rather than the previous one.
      when 'GROUP_REPORT' then
        v_result := refresh_cons_totals(true);
        v_rows := coalesce((v_result->>'rows')::int, 0);
        v_message := format('Consolidated totals refreshed: %s row(s) in %s ms',
                            v_result->>'rows', v_result->>'elapsed_ms');

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
$function$
;

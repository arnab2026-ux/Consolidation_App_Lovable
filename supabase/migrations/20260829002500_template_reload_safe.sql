-- Phase 5: loading the standard close template a second time must not fail.
--
-- seed_standard_workflow_template() cleared its steps with
--     delete from workflow_step where template_id = v_template
-- before re-inserting them. Once a close has run, task_run.step_id references
-- those rows, so the delete is refused:
--
--   update or delete on table "workflow_step" violates foreign key constraint
--   "task_run_step_id_fkey" on table "task_run"
--
-- Which means the "Load standard close" button worked exactly once per
-- workspace and then failed for good - and the failure surfaces as a raw
-- constraint error, not as anything a user could act on.
--
-- The steps are now upserted on (template_id, step_no), which the table already
-- has a unique constraint for. Existing steps keep their identity, so the
-- history hanging off them stays intact, and re-loading becomes a way to reset
-- a template to the standard rather than a one-shot.

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
    (v_tenant, v_template, 11, 'LOCK_PERIOD' , 'Lock period'                  , 'GROUP' , true , true , array[10])
  on conflict (template_id, step_no) do update
    set task_type = excluded.task_type,
        name = excluded.name,
        scope = excluded.scope,
        is_blocking = excluded.is_blocking,
        requires_approval = excluded.requires_approval,
        depends_on_step_no = excluded.depends_on_step_no;

  return v_template;
end
$function$;

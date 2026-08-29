-- Phase 3: correct what counts as a satisfied dependency.
--
-- workflow_deps_met required the upstream task to be SUCCESS, which stalled a
-- close on its first warning. Intercompany reconciliation finishing WARNING
-- because a pair is genuinely out of balance is a normal, expected outcome -
-- the whole point of the step is to report it - and it must not stop the close.
--
-- Prompt 16 states the rule: blocking steps in ERROR halt downstream execution
-- for that scope; non-blocking steps allow continuation with a warning. So:
--
--   SUCCESS, WARNING          -> satisfied
--   ERROR on a non-blocking   -> satisfied (continue, carrying the warning)
--   ERROR on a blocking step  -> blocks
--   PENDING, RUNNING          -> blocks (not finished)
--   REVERSED                  -> blocks (the work was undone)

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
       and not (
         t.status in ('SUCCESS', 'WARNING')
         or (t.status = 'ERROR' and not coalesce(v_dep_step.is_blocking, true))
       )
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

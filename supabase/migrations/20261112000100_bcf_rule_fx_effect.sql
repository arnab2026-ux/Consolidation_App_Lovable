-- The seeded carry-forward rule left the group's opening entries out of balance.
--
-- BCF01 carries source_movement_class = {CLOSING}. Reported data sits on the
-- closing movement, so at entity level that is everything. At group level it is
-- not: when consolidation of investments removes an investee's equity it
-- reverses the cumulative translation adjustment on the movement that reserve
-- was posted with, FX_EFFECT. Those rows were filtered out of the carry, and
-- the group opening entries were out by exactly that amount - 312,800 on the
-- demo data, found by the end-to-end test of 20261111000200.
--
-- An opening balance is the whole of the prior closing position, whichever
-- movement built it up, so the rule has to take FX_EFFECT as well.
--
-- Only a rule still carrying the seeded default is touched. One that has been
-- edited is a decision somebody made and is left alone.

update public.rule_bcf
   set source_movement_class = array['CLOSING', 'FX_EFFECT']
 where code = 'BCF01'
   and source_movement_class = array['CLOSING']::text[];

-- The seed implementation still writes {CLOSING}. It is a 35 KB function that
-- should not be re-issued for one array literal, so the administrator-only
-- entry point corrects the rule after seeding. Fold this into
-- seed_demo_dataset_impl the next time that body is replaced, and drop it here.
create or replace function public.seed_demo_dataset(p_reset boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null then
    raise exception 'No workspace for the current user';
  end if;
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only an administrator can load the demo dataset' using errcode = '42501';
  end if;

  v_result := seed_demo_dataset_impl(v_tenant, p_reset);

  update rule_bcf
     set source_movement_class = array['CLOSING', 'FX_EFFECT']
   where tenant_id = v_tenant
     and code = 'BCF01'
     and source_movement_class = array['CLOSING']::text[];

  return v_result;
end
$function$;

revoke execute on function public.seed_demo_dataset(boolean) from public, anon;

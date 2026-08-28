-- Phase 1 - Prompt 18 item 3: posting guards.
--
-- Two layers, split by cost:
--
--   * enforce_posting_level()  - row level, BEFORE. Only checks that need no
--     lookups: posting-level/consolidation-group coherence and partner<>entity.
--
--   * enforce_fact_slice()     - statement level, AFTER, over a transition
--     table. Everything needing a join (entity local currency, period status)
--     runs once per statement instead of once per row, which matters because
--     the calculation engines insert in bulk.

-- ---------------------------------------------------------------- row level
create or replace function public.enforce_posting_level()
returns trigger
language plpgsql
as $function$
begin
  -- Reported and standardising data is entity level: it must not carry a group.
  if new.posting_level in ('00', '01') then
    if new.entity_id is null then
      raise exception 'Posting level % requires an entity', new.posting_level;
    end if;
    if new.cons_group_id is not null then
      raise exception 'Posting level % must not carry a consolidation group', new.posting_level;
    end if;

  -- Consolidation postings are group dependent: they must carry a group.
  elsif new.posting_level in ('10', '20', '30') then
    if new.cons_group_id is null then
      raise exception 'Posting level % requires a consolidation group', new.posting_level;
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

-- ---------------------------------------------------------- statement level
create or replace function public.enforce_fact_slice()
returns trigger
language plpgsql
as $function$
declare
  v_bad record;
begin
  -- Local currency on the row must be the entity's own local currency.
  select n.entity_id, n.local_currency, e.code, e.local_currency as entity_ccy
    into v_bad
    from newrows n
    join dim_entity e on e.id = n.entity_id
   where n.local_currency is distinct from e.local_currency
   limit 1;

  if found then
    raise exception 'Entity % keeps its books in %, but a row was posted in %',
      v_bad.code, v_bad.entity_ccy, v_bad.local_currency;
  end if;

  -- The target period must be open. Period 0 (carry-forward) is exempt: it is
  -- opened by the year-end roll, not by the period calendar.
  select n.fiscal_year, n.period, ps.status
    into v_bad
    from newrows n
    join period_status ps
      on ps.tenant_id = n.tenant_id
     and ps.version_id = n.version_id
     and ps.fiscal_year = n.fiscal_year
     and ps.period = n.period
     and (ps.cons_group_id is null or ps.cons_group_id is not distinct from n.cons_group_id)
   where n.period <> 0
     and ps.status in ('LOCKED', 'CLOSED')
   limit 1;

  if found then
    raise exception 'Period %/% is % - posting is not allowed',
      v_bad.fiscal_year, v_bad.period, v_bad.status;
  end if;

  return null;
end
$function$;

-- Postgres allows a transition table on single-event triggers only, so the
-- insert and update paths get one trigger each over the same function.
drop trigger if exists fact_balances_slice_guard on public.fact_balances;
drop trigger if exists fact_balances_slice_guard_ins on public.fact_balances;
drop trigger if exists fact_balances_slice_guard_upd on public.fact_balances;

create trigger fact_balances_slice_guard_ins
  after insert on public.fact_balances
  referencing new table as newrows
  for each statement execute function public.enforce_fact_slice();

create trigger fact_balances_slice_guard_upd
  after update on public.fact_balances
  referencing new table as newrows
  for each statement execute function public.enforce_fact_slice();

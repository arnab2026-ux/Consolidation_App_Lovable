-- Phase 0 cleanup.
--
-- create_model_fact_table() came from Appendix A of the build pack (the
-- "runtime DDL" alternative that was never adopted). It is:
--   * unreferenced by the application,
--   * SECURITY DEFINER and builds DDL by string interpolation,
--   * already broken - it inserts into model_registry, which does not exist.
--
-- The project uses the reserved-slot model (dim_registry -> zdim01..zdim10),
-- so this function is dead weight with a real privilege-escalation shape.

drop function if exists public.create_model_fact_table(text, text[]);

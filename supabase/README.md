# Database workflow

All schema changes go through a file in `migrations/`. Nothing is pasted into the
Supabase SQL editor any more — that is how the project ended up with no migration
history and a set of functions nobody could diff.

## Setup (once)

```bash
cp .env.example .env.local
```

Fill in `SUPABASE_DB_URL` from Supabase Dashboard → Project Settings → Database →
Connection string → **Session pooler**. `.env.local` is gitignored.

## Commands

| Command | What it does |
|---|---|
| `npm run db:apply -- supabase/migrations/<file>.sql` | Applies one migration in a transaction and records it in `supabase_migrations.schema_migrations`. Re-running is a no-op; `--force` re-applies. |
| `npm run db:types` | Regenerates `src/integrations/supabase/types.ts` from the live database, including Views and Functions. |
| `npm run db:dump -- <file>.sql` | Snapshots the whole `public` schema to a file. |
| `npm run db:check` | Fails on any DELETE/UPDATE without a WHERE clause. See below. |
| `npm run db:smoke` | Calls every RPC the application calls. See below. |

These scripts talk to Postgres directly, so unlike the Supabase CLI they do **not**
require Docker.

## Rules

1. **Every migration is a new file.** Name it `<UTC timestamp>_<slug>.sql`. Never
   edit a migration that has been applied — write a follow-up.
2. **Run `npm run db:types` after every migration**, and commit the regenerated
   types with it. A schema change and its types belong in the same commit.
3. **Then run `npm run db:check`, `npm run db:smoke` and `npm run typecheck`.** The types are the contract between the
   engines and the UI; if an RPC signature moved, this is where you find out.
4. Migrations must be **idempotent where practical** (`if not exists`,
   `create or replace`) so a partial failure can be re-run.

## Files

- `20260828120000_baseline_prompt11.sql` — reconstructed record of the schema as
  built through Prompt 11 of the build pack, before migrations existed. Already
  applied to the live database; it exists to version the starting point and to
  rebuild a fresh project from scratch.
- `20260829000100_drop_runtime_ddl_function.sql` — removes the unused Appendix A
  runtime-DDL function.
- `20260829000200_posting_guards.sql` — Prompt 18 item 3.
- `20260829000300_seed_demo_dataset.sql` — Prompt 18 item 2. Creates
  `seed_demo_dataset(p_tenant, p_reset)`; see below.
- `20260829000400_fix_balance_carry_forward.sql` — repairs three defects that
  stopped entity BCF from ever running.
- `20260829000500_bcf_journal_cleanup.sql` — stops repeated BCF runs orphaning
  empty journal headers.
- `20260829000600_bcf_ytd_period_model.sql` — makes BCF read the prior year's
  closing period instead of summing every period (decision D3).
- `20260829000700_net_income.sql` — Prompt 12. `run_net_income` wrapper,
  `run_net_income_entity` / `run_net_income_group` workers, and
  `verify_balance_sheet` for the screen's verification card.
- `20260829000800_entity_rows_drop_group_currency.sql` — decision D1: levels
  00/01 stop carrying `amount_gc`; the seed gains historical equity rates.
- `20260829000900_currency_translation.sql` — Prompt 13. Posting level `05`
  (D5), `resolve_translation_rate`, `check_fx_coverage`,
  `run_currency_translation` and its entity worker.
- `20260829001000_translation_coverage.sql` — decision D6: report accounts no
  translation rule claims instead of letting the CTA absorb them.
- `20260829001100_ic_elimination.sql` — Prompt 14. `run_ic_reconciliation`,
  `run_ic_elimination`, the `run_ic` wrapper and `ic_matrix` for the report.
- `20260829001200_consolidation_of_investments.sql` — Prompt 15. `run_coi_entity`
  covering the purchase, proportionate and equity methods, and `run_coi`.
- `20260829001300_coi_scoped_cleanup.sql` — scopes the COI re-run cleanup to its
  own document; scoping by entity wiped rows posted against a shared investor.
- `20260829001400_workflow_orchestration.sql` — Prompt 16. The standard close
  template, `start_workflow_run`, `workflow_deps_met`, `run_workflow_task` and
  `workflow_monitor`.
- `20260829001500_workflow_dep_semantics.sql` — a WARNING no longer blocks
  downstream steps; only a blocking step in ERROR does.
- `20260829001600_seed_reset_workflow.sql` — the demo seed can reset a tenant
  that already has close runs on it.
- `20260829001700_reporting.sql` — Prompt 17. `report_trial_balance`,
  `report_statement` (hierarchy rollup with a comparison period),
  `report_drilldown`, `report_audit_trail` and `report_journal_lines`.
- `20260829001800_validation_rules.sql` — Prompt 18 item 1. `validation_rule`
  and `run_validations`.
- `20260829001900_workflow_runs_validations.sql` — the close's validation step
  runs the rule set and keeps findings on `task_run.log`.
- `20260829002000_mv_cons_totals.sql` — Prompt 18 item 4. Pre-aggregated
  statement slice plus `refresh_cons_totals` and `report_cons_totals`.
- `20260829002100_workflow_refreshes_totals.sql` — the close refreshes it.
- `20260829002200_validation_stages.sql` — decision D11: rules carry the stage
  at which they are meaningful.
- `20260829002300_validation_fixes.sql` — drops an ambiguous overload; the
  consolidated balance check goes group-wide.
- `20260829002400_refresh_not_concurrent.sql` — concurrent refresh is not
  possible inside a transaction.
- `20260829002500_template_reload_safe.sql` — "Load standard close" upserts its
  steps, so it works more than once.
- `20260829002600_task_run_journal_fk.sql` — `task_run.journal_id` and
  `upload_batch.journal_id` cascade to null, so an engine can replace its own
  document on a re-run.

## Demo dataset

```sql
select seed_demo_dataset();          -- current user's tenant, wipes and rebuilds
select seed_demo_dataset(null, false); -- keep existing rows, top up master data
```

Builds a five-entity group (USD/USD/EUR/SAR/INR) across all four consolidation
methods, a 64-account chart, two years of trial balance, FX rates, an account
hierarchy and one default rule of every kind. Every entity's trial balance sums
to exactly zero in local currency, and the intercompany positions are chosen to
produce one of every reconciliation outcome — including a deliberate 50,000 USD
mismatch between SUB_US and JV_SA, and a one-sided balance from SUB_EU.

It is destructive by default (`p_reset = true` deletes the tenant's data first),
so it is a development and demo tool, not something to point at real data.


## Why `db:check` exists

Supabase preloads `pg_safeupdate` for the **`authenticator`** role — the role
PostgREST connects as — so every call through the API rejects a DELETE or UPDATE
that has no WHERE clause, with:

```
DELETE requires a WHERE clause
```

That includes a temporary table the function created moments earlier.

These scripts connect as the pooler superuser, which has no such preload and
cannot load the library on demand (supautils restricts it). So this class of bug
**runs clean from SQL and fails only in the running application**. Currency
translation shipped with exactly one, clearing its temporary rate map with a bare
`delete from _tr_map;`.

`npm run db:check` scans every function for the pattern. Run it after every
migration. Use `TRUNCATE` for temporary tables.

Two other `authenticator` settings worth knowing, for the same reason — they do
not apply to these scripts but do apply to the app:

- `statement_timeout = 8s`
- `lock_timeout = 8s`

The close runs one task per request so each stays well inside that, but a much
larger group could not. The non-concurrent `REFRESH MATERIALIZED VIEW` in the
Group Reports step takes an exclusive lock, and currently completes in about
15 ms.


## Why `db:smoke` exists

`column reference "task_run_id" is ambiguous` shipped in **all five** engine
wrappers — including `run_bcf`, which had carried it since the original build.
Each is declared `RETURNS TABLE (task_run_id uuid, ...)`, and in plpgsql an
output column name is a variable in scope for the whole body, so this subquery

```sql
(select id from journal_header where task_run_id = v_task limit 1)
```

reads `task_run_id` as both the variable and the column.

It went unnoticed for the whole build because every end-to-end test drove the
**workers** (`run_bcf_entity`, `run_ic_elimination`, …) or `run_workflow_task`,
which returns `jsonb` and has no such output columns. The Consolidation Monitor
therefore worked perfectly while **every per-screen Run button was broken**.

Nothing catches this before the function is executed — not a migration applying
cleanly, not `db:check`, not the typechecker. `npm run db:smoke` calls each RPC
the way the client calls it, inside a transaction it rolls back, so the same
class of defect fails a check instead of a user.

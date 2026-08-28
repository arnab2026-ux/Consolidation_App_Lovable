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

These scripts talk to Postgres directly, so unlike the Supabase CLI they do **not**
require Docker.

## Rules

1. **Every migration is a new file.** Name it `<UTC timestamp>_<slug>.sql`. Never
   edit a migration that has been applied — write a follow-up.
2. **Run `npm run db:types` after every migration**, and commit the regenerated
   types with it. A schema change and its types belong in the same commit.
3. **Then run `npm run typecheck`.** The types are the contract between the
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

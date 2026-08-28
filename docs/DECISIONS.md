# Architecture decisions

Decisions that override or clarify the original build pack
(`consolidation-app-lovable-prompt-pack.md`). The pack is the starting spec, not
the final authority — where this file disagrees with it, this file wins.

---

## D1 — Currency translation posts new rows; it never updates balances in place

**Date:** 2026-08-29 · **Status:** accepted · **Supersedes:** Prompt 13, step 3

Prompt 13 said translation should `UPDATE amount_gc` on the existing posting-level
00/01 rows ("translation enriches reported data rather than posting new lines").

That is rejected. It contradicts Project Knowledge rule 3 (*balances are never
updated in place*), it destroys reversibility by `task_run_id`, and it breaks
outright when one entity belongs to two consolidation groups with different group
currencies — the two groups would overwrite each other's `amount_gc`.

**Decision.** `run_currency_translation` **inserts new rows**, each stamped with:

- `cons_group_id` — the group the translation was run for,
- `source_task = 'TRANSLATION'`,
- `task_run_id` — so `reverse_task_run()` undoes it like every other engine,
- `amount_gc` = the translated amount, and `amount_lc = 0`.

`amount_lc = 0` keeps local-currency reporting unaffected by translation, and
lets the same entity carry a different group-currency amount under every group it
belongs to.

### Consequence still to be resolved (before Phase 2)

`post_upload_batch` currently sets `amount_gc = amount_lc` on every level-00 row,
and `post_manual_journal` does the same whenever local = group currency. Under D1
that double counts: the reported row already carries a group-currency amount and
translation adds another.

The self-consistent fix is that **entity-level rows (levels 00/01) carry
`amount_gc = 0`** — group currency is group-dependent and simply not knowable at
entity level — and translation supplies every group-currency figure, including the
trivial same-currency case at rate 1.0. That makes translation a mandatory task
for every entity, which is also how SAP Group Reporting behaves.

Not yet implemented. It changes Prompt 9 / Prompt 10 code, so it lands with the
translation engine.

---

## D2 — Workflow orchestration runs as RPC + client driver, not an Edge Function

**Date:** 2026-08-29 · **Status:** proposed · **Amends:** Prompt 16

Prompt 16 specified an Edge Function `run-workflow` to resolve the dependency
graph and call each RPC in turn.

Every engine is already a Postgres function, and the BCF screen already does
run-then-poll against `task_run`. A `run_workflow_task(p_task_run_id)` RPC plus a
dependency-graph driver in React gives live per-cell progress on the Consolidation
Monitor for free, with no deploy pipeline and no second copy of the dependency
rules.

Move to an Edge Function only if a group-scope run exceeds the request timeout.

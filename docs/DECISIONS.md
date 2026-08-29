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

---

## D3 — Balances and P&L are both year-to-date as at the stated period

**Date:** 2026-08-29 · **Status:** accepted

The pack never states whether `fact_balances` holds periodic or cumulative
figures, and the two engines written before this point disagreed with each
other.

`validate_upload_batch` requires each uploaded period's trial balance to sum to
zero per entity. That can only hold if the balance sheet and the P&L are on the
same basis — a year-to-date balance sheet against a periodic P&L balances only
in period 1. So the model is **year-to-date on both**: a row for period *p* is
the position as at the end of period *p*, and period 12 already carries the full
year.

**Consequences.**

- An engine reading a year's result reads **one period**, never a sum across
  periods. `run_net_income` does this.
- Prior-year closing is the **highest period carrying data**, not the sum of
  every period. `run_bcf_entity` / `run_bcf_group` were summing all periods,
  which is correct by accident while each year holds a single period and a 12x
  overstatement the moment monthly data is loaded. Fixed in
  `20260829000600_bcf_ytd_period_model.sql`.

If periodic storage is ever wanted, it should arrive as an explicit column or
version attribute rather than by convention, and every engine revisited.

---

## D4 — The NCI profit split belongs to consolidation of investments, not net income

**Date:** 2026-08-29 · **Status:** accepted · **Resolves:** Prompt 12 item 4 vs Prompt 15

Prompt 12 item 4 says net income should split the result by
`group_share_pct` and post the minority share at posting level 20. Prompt 15
says consolidation of investments should post "minority share of net income to
`nci_pl_account_code`". Implementing both would double count non-controlling
interests.

**Decision.** Consolidation of investments owns it. That engine already knows
the consolidation method (only `PURCHASE` recognises NCI at all — proportionate
recognises none, equity excludes the investee entirely), holds both the equity
and P&L NCI accounts, and handles first versus subsequent consolidation and
disposals. `rule_net_income` has only `minority_account_code`, one account,
which cannot express a two-sided posting.

`rule_net_income.split_to_minority` and `minority_account_code` are kept and
still editable, but `run_net_income_*` does not act on them. The rule editor
says so in the form rather than silently ignoring the setting.

**What net income does at group level instead:** consolidation postings at
levels 10, 20 and 30 carry their own P&L effects, and those must reach equity
too or the consolidated balance sheet stops footing once eliminations land.
`run_net_income_group` transfers each level's result at that same level. This is
step 9, "Net Income (group)", of the standard close template.

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

**Date:** 2026-08-29 · **Status:** accepted (implemented Phase 3) · **Amends:** Prompt 16

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

---

## D5 — Currency translation posts at its own posting level, `05`

**Date:** 2026-08-29 · **Status:** accepted · **Extends:** D1, Project Knowledge rule 4

D1 settled that translation posts its own rows carrying `cons_group_id`. That
collides with the posting-level guard: `00`/`01` are entity level and must not
carry a group, while `10`/`20`/`30` must — but those mean IC elimination,
consolidation of investments and group manual adjustment. A translation row is
none of the three.

Reusing one of them would make every report that slices by posting level
misattribute where a number came from, and would break the "undo by posting
level" story. So translation gets **`05`**: group-dependent, and entity-scoped
within the group, sitting between reported data and consolidation entries.

`posting_level` is a bare `char(2)` with no check constraint, so the only thing
that had to change is `enforce_posting_level` / `enforce_journal_posting_level`.

**Consequence for reporting (Phase 4).** The posting-level sets in Prompt 17
must become:

- Reported only → `{00}`
- Reported + adjustments → `{00, 01}`
- Fully consolidated → `{00, 01, 05, 10, 20, 30}`

Group-currency figures only exist at `05` and above, because under D1 levels
`00`/`01` carry `amount_gc = 0`. A group-currency report that omits `05` returns
zero, not a wrong number — which is at least loud.

---

## D6 — An account no translation rule claims is reported, never absorbed

**Date:** 2026-08-29 · **Status:** accepted

The cumulative translation adjustment is computed as the balancing figure of
the translated balance sheet. That makes it a sink: any account that fails to
get translated silently disappears into the plug, and the result still foots,
so nothing looks wrong.

This is not hypothetical. The seeded rule set had no rule matching "Net income
for the period" — a balance sheet account carried at the AVERAGE rate, so that
it ties to the P&L result that produced it. The balance-sheet rule wanted
`BS + CLOSING`, the P&L rule wanted `PL`, and neither claimed it. The CTA
absorbed the whole of net income, reporting a translation adjustment of
3,470,000 USD for a **USD entity inside a USD group**, where the right answer is
zero.

**Decision.** `run_currency_translation_entity` counts accounts that carry a
balance in the slice but that no active rule claims, and returns them in its
result so the run panel can show them. Accounts with `translation_method =
'NONE'` are excluded: that is deliberate non-translation, as on the CTA account
itself.

A balancing figure must never be the only thing standing between a coverage gap
and a plausible-looking number.

---

## D7 — Intercompany elimination scales by consolidation method, not ownership percentage

**Date:** 2026-08-29 · **Status:** accepted · **Amends:** Prompt 14 items 2 and 4

Prompt 14 says to apply `cons_group_member.group_share_pct` "when either entity
is consolidated proportionately", and to reverse both legs "up to the matched
amount". Both need correcting.

**Scaling.** Using the ownership percentage directly would be wrong for the
ordinary case. An 80%-owned subsidiary is *fully* consolidated, with
non-controlling interests presented separately — intercompany balances against
it are eliminated in full, not at 80%. What decides the factor is the
consolidation **method**:

| Method | Factor | Why |
|---|---|---|
| `PURCHASE` | 1.0 | fully consolidated; NCI is shown separately |
| `PROPORTIONATE` | `group_share_pct / 100` | only the group's share is in the accounts |
| `EQUITY` | 0.0 | the investee is outside the group |

A pair is eliminated at the **lower** of the two entities' factors. The equity
case matters: a receivable from an equity-method investee is a genuine external
receivable and must survive consolidation. That is why the seeded
`SUB_EU -> ASSOC_IN` position is reported `ONE_SIDED` and correctly left alone,
rather than being treated as a data-quality problem.

**Difference handling.** Reversing only "up to the matched amount" leaves part
of an intercompany balance sitting in the consolidated accounts, which defeats
the purpose. Both legs are eliminated in full at the group's factor and the
mismatch is posted to the rule's difference account, so the entry balances and
no intercompany balance survives.

A pair classified `DIFFERENCE` whose rule has no real-difference account is not
eliminated at all, and is reported as blocked — silently eliminating a known
mismatch into nowhere would be worse than leaving it visible.

**FX versus real difference.** The pack asks for the exchange-driven portion to
be split out. Without a shared transaction currency between the two legs there
is no honest way to attribute the gap to exchange movement, so it is reported as
a real difference rather than guessed at. The currency-difference account is
wired up for the case where both legs do share a transaction currency.

---

## Sequencing note — the close order is now load-bearing

Each engine reads what the previous one wrote, so the order in the standard
close template is a correctness requirement, not a convention:

```
BCF -> Net income (entity) -> Translation -> IC reconciliation
    -> IC elimination -> Net income (group)
```

- **Translation** reads levels 00/01, so it must follow BCF and entity net income.
- **IC reconciliation** reads level 05, so it must follow translation. It refuses
  to run against an untranslated slice, because comparing zeroes would report
  everything as `MATCHED`.
- **Net income (group)** must follow elimination: the difference booked to profit
  and loss leaves the group balance sheet out by that amount until the group
  result is taken to equity. Verified end to end — the group balance sheet is
  out by exactly the 25,000 difference after elimination, and foots to zero once
  the group net income step runs.

Enforcing this is what the Consolidation Monitor (Prompt 16) is for.

---

## D8 — Non-controlling interests are posted on the balance sheet; the profit split is presentation

**Date:** 2026-08-29 · **Status:** accepted · **Refines:** D4, Prompt 15

D4 gave the NCI split to consolidation of investments. Implementing it exposed a
double count. The equity elimination already credits NCI with the minority share
of the investee's **net assets**, and net assets include the current period's
result. Posting a further `Dr NCI share of profit / Cr NCI equity` would credit
the minority with its share of the result twice.

**Decision.** The elimination entry credits NCI equity with the minority share
of net assets, in full, on the balance sheet. The profit attributable to
non-controlling interests is **computed and reported** — returned by the engine,
shown on the run screen, and available to the statements — but not posted as a
separate journal. `rule_coi.nci_pl_account_code` names the line the reports use.

Splitting the result between owners and non-controlling interests is a
presentation of the same equity, not a further movement of it. A journal that
nets to nothing is worse than no journal: it implies a transaction happened.

---

## D9 — Scaling or reversing an entity's translated data leaves the net-income account alone

**Date:** 2026-08-29 · **Status:** accepted

Every posting at levels 10/20/30 must sum to zero across all its lines, balance
sheet and profit and loss together. Group net income then transfers the level's
P&L into equity and the group balance sheet foots. That invariant is what makes
the whole chain closeable.

It has one non-obvious consequence. A translated entity's rows are **not** a
balanced set: its balance sheet foots to zero *including* its net-income equity
line, while its P&L still carries the result. So reversing all of an entity's
translated rows — as the equity method must, and as proportionate scaling does
in part — leaves an entry out by exactly that result.

**Decision.** When consolidation of investments scales or reverses an entity's
translated data, rows on the account flagged `is_net_income` are excluded. The
reversal then balances, and group net income re-creates the line at level 20.
Same answer, without an unbalanced journal.

Verified: with this rule the group balance sheet foots to 0.00 at level 05,
level 10, level 20 and in total, and the consolidated result of 5,277,480 USD is
independently derivable — the three fully consolidated entities in full, the
joint venture at 50%, the associate at 30%, less the 25,000 intercompany
difference, plus the 700,000 bargain purchase gain on SUB_US.

---

## Not implemented in Prompt 15

`PARTIAL_DISPOSAL`, `TOTAL_DISPOSAL` and `STEP_ACQUISITION` raise an explicit
error rather than posting something plausible. They need prior-period goodwill
and non-controlling interests carried forward by a group balance carry forward,
and disposal-specific test data, neither of which exists yet. Refusing is
better than a silently wrong gain on disposal.

To finish them: run `run_bcf_group` for the consolidation group so level-20
goodwill and NCI roll into the new year, add register rows carrying the
disposal proceeds and the ownership change, then derecognise the proportion
disposed of and post the difference against proceeds to profit and loss.

---

## D10 — A warning does not stop a close

**Date:** 2026-08-29 · **Status:** accepted

The first version of `workflow_deps_met` required an upstream task to be
`SUCCESS`. That stalled the close at its first warning: intercompany
reconciliation finishing `WARNING` because a pair is genuinely out of balance is
the step working correctly — reporting the difference is the entire point of it —
and it must not block elimination.

Prompt 16 already states the rule; the implementation just did not follow it.
A dependency counts as satisfied when the upstream task is:

| Upstream status | Satisfied? |
|---|---|
| `SUCCESS`, `WARNING` | yes |
| `ERROR` on a **non-blocking** step | yes — continue, carrying the warning |
| `ERROR` on a **blocking** step | no |
| `PENDING`, `RUNNING` | no — not finished |
| `REVERSED` | no — the work was undone |

Only caught by driving a whole close end to end. Steps 1 to 6 ran, and
everything from 7 onward sat `PENDING` with no error to explain why.

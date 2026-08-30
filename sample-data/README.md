# Sample trial balance

Upload files for the seeded demo group, generated from its own entity and
account master data and dry-run through the real validator before being written.

## What is here

| File | Contents |
|---|---|
| `trial-balance-2026-P06-all-entities.csv` | all five entities, 85 lines — upload this one |
| `trial-balance-2026-P06-<ENTITY>.csv` | the same data split per entity, if you would rather load them one at a time |

**Period 2026 / 06 is deliberate.** The demo seed already posts 2025/12 and
2026/12, so a mid-year period gives you a clean slice to upload into without
colliding with it. Exchange rates and period status already exist for every
period of 2026, so nothing else has to be set up first.

## How to load it

1. Set the point of view in the top bar to **Version ACT01, 2026, period 6,
   group GRP_WW**. The upload takes the year and period from there, not from
   the file.
2. **Data → Upload Trial Balance**, drop the combined CSV in.
3. On the mapping step every column should already be matched — the headers are
   the target column names, so the auto-mapper finds all of them. Check it and
   move on.
4. Validate. You should see **85 rows, 85 valid, 0 errors**, and all five
   entities showing a balanced trial balance.
5. Post.
6. **Process → Consolidation Monitor** → *Open close* → *Run all*.

## What you should see

The close runs 11 steps over 30 cells. Step 6, intercompany reconciliation,
finishes **WARNING** — that is correct and deliberate, not a fault: the data
contains one genuinely out-of-balance pair. Everything else is SUCCESS.

Intercompany reconciliation produces one of every outcome, which is the point of
the shape of this data:

| Pair | Outcome | Why |
|---|---|---|
| PARENT ↔ SUB_EU receivable/payable | MATCHED | EUR 600,000 × 1.25 = USD 750,000 exactly |
| PARENT ↔ SUB_EU revenue/purchases | MATCHED | EUR 500,000 × 1.20 average = USD 600,000 |
| PARENT ↔ SUB_US loan | MATCHED | same currency |
| PARENT ↔ SUB_US interest | MATCHED | same currency |
| SUB_US ↔ JV_SA | **DIFFERENCE** | USD 475,000 against SAR 1,700,000 × 0.25 = 425,000, so 50,000 apart |
| SUB_EU → ASSOC_IN | **ONE_SIDED** | the associate is equity-method, outside the group, so this is a genuine external receivable and is correctly left alone |

Consolidated result, which you can check on **Reports → Consolidated
Statements** with *Fully consolidated* selected:

```
Balance sheet                                    0.00
Consolidated profit                      2,751,240

  PARENT + SUB_US in full                2,095,000
  SUB_EU at the 1.20 average rate            90,000
  JV_SA at 50% (proportionate)               95,000
  ASSOC_IN at 30% (equity method)            21,240
  less the intercompany difference          (25,000)
  plus the bargain purchase on SUB_US       475,000
```

## Regenerating

```bash
npm run sample:tb
```

Reads the current account and entity master data, derives retained earnings as
the balancing figure so every entity foots exactly, checks partner and movement
requirements against `dim_account`, then dry-runs the files through
`validate_upload_batch` in a transaction it rolls back. Change `YEAR` and
`PERIOD` at the top of `scripts/gen-sample-tb.mjs` for a different slice.

## A note on the file format

`transaction_currency` obliges `amount_tc`: `validate_upload_batch` rejects a
row that names a transaction currency without an amount in it. Here the
transaction currency is each entity's own, so the two amounts are the same. Drop
both columns if you only ever load local-currency figures.

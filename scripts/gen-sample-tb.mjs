import { mkdirSync, writeFileSync } from "node:fs";
import { connect } from "./scripts/db-connect.mjs";

const TENANT = "242e0719-8bf3-4eab-84de-be3c52a63cfa";
const YEAR = 2026;
const PERIOD = 6;

// Half-year trial balances. Retained earnings (3100) is deliberately omitted -
// it is derived as the balancing figure so every entity foots exactly.
// Intercompany positions mirror the seeded ones so reconciliation still yields
// one of every outcome at the rates on file (EUR 1.25 close / 1.20 average,
// SAR 0.25, INR 0.0125 / 0.0120).
const TB = [
  // PARENT (USD)
  ["PARENT", "1000", "", "", 4600000],
  ["PARENT", "1100", "", "", 3050000],
  ["PARENT", "1110", "", "SUB_EU", 750000],
  ["PARENT", "1130", "", "SUB_US", 2000000],
  ["PARENT", "1200", "", "", 1450000],
  ["PARENT", "1400", "199", "", 11500000],
  ["PARENT", "1410", "199", "", -3800000],
  ["PARENT", "1700", "199", "SUB_US", 2000000],
  ["PARENT", "1700", "199", "SUB_EU", 6400000],
  ["PARENT", "1710", "199", "JV_SA", 1500000],
  ["PARENT", "1710", "199", "ASSOC_IN", 900000],
  ["PARENT", "2000", "", "", -2000000],
  ["PARENT", "2210", "", "", -6000000],
  ["PARENT", "3000", "199", "", -10000000],
  ["PARENT", "4000", "", "", -9000000],
  ["PARENT", "4010", "", "SUB_EU", -600000],
  ["PARENT", "4300", "", "SUB_US", -60000],
  ["PARENT", "5000", "", "", 5000000],
  ["PARENT", "5100", "", "", 1750000],
  ["PARENT", "5300", "", "", 225000],
  ["PARENT", "5500", "", "", 450000],
  ["PARENT", "5900", "", "", 500000],
  // SUB_US (USD, 100% purchase)
  ["SUB_US", "1000", "", "", 1000000],
  ["SUB_US", "1100", "", "", 1300000],
  ["SUB_US", "1110", "", "JV_SA", 475000],
  ["SUB_US", "1200", "", "", 650000],
  ["SUB_US", "1400", "199", "", 3100000],
  ["SUB_US", "1410", "199", "", -1200000],
  ["SUB_US", "2000", "", "", -850000],
  ["SUB_US", "2220", "", "PARENT", -2000000],
  ["SUB_US", "3000", "199", "", -1000000],
  ["SUB_US", "4000", "", "", -3400000],
  ["SUB_US", "5000", "", "", 2050000],
  ["SUB_US", "5100", "", "", 675000],
  ["SUB_US", "5500", "", "", 150000],
  ["SUB_US", "5600", "", "PARENT", 60000],
  ["SUB_US", "5900", "", "", 105000],
  // SUB_EU (EUR, 80% purchase)
  ["SUB_EU", "1000", "", "", 775000],
  ["SUB_EU", "1100", "", "", 1600000],
  ["SUB_EU", "1110", "", "ASSOC_IN", 90000],
  ["SUB_EU", "1200", "", "", 925000],
  ["SUB_EU", "1400", "199", "", 4200000],
  ["SUB_EU", "1410", "199", "", -1625000],
  ["SUB_EU", "2000", "", "", -1175000],
  ["SUB_EU", "2010", "", "PARENT", -600000],
  ["SUB_EU", "2210", "", "", -1500000],
  ["SUB_EU", "3000", "199", "", -2000000],
  ["SUB_EU", "4000", "", "", -3950000],
  ["SUB_EU", "5000", "", "", 2250000],
  ["SUB_EU", "5010", "", "PARENT", 500000],
  ["SUB_EU", "5100", "", "", 825000],
  ["SUB_EU", "5500", "", "", 190000],
  ["SUB_EU", "5900", "", "", 110000],
  // JV_SA (SAR, 50% proportionate)
  ["JV_SA", "1000", "", "", 1950000],
  ["JV_SA", "1100", "", "", 3400000],
  ["JV_SA", "1200", "", "", 1600000],
  ["JV_SA", "1400", "199", "", 8300000],
  ["JV_SA", "1410", "199", "", -3000000],
  ["JV_SA", "2000", "", "", -2550000],
  ["JV_SA", "2010", "", "SUB_US", -1700000],
  ["JV_SA", "2210", "", "", -3000000],
  ["JV_SA", "3000", "199", "", -4000000],
  ["JV_SA", "4000", "", "", -6750000],
  ["JV_SA", "5000", "", "", 4050000],
  ["JV_SA", "5100", "", "", 1350000],
  ["JV_SA", "5500", "", "", 390000],
  ["JV_SA", "5900", "", "", 200000],
  // ASSOC_IN (INR, 30% equity)
  ["ASSOC_IN", "1000", "", "", 13000000],
  ["ASSOC_IN", "1100", "", "", 30000000],
  ["ASSOC_IN", "1200", "", "", 16000000],
  ["ASSOC_IN", "1400", "199", "", 63000000],
  ["ASSOC_IN", "1410", "199", "", -24000000],
  ["ASSOC_IN", "2000", "", "", -19000000],
  ["ASSOC_IN", "2210", "", "", -25000000],
  ["ASSOC_IN", "3000", "199", "", -30000000],
  ["ASSOC_IN", "4000", "", "", -52500000],
  ["ASSOC_IN", "5000", "", "", 31500000],
  ["ASSOC_IN", "5100", "", "", 10500000],
  ["ASSOC_IN", "5500", "", "", 3000000],
  ["ASSOC_IN", "5900", "", "", 1600000],
];

const client = await connect();

// --- master data, so the file can be checked before anyone uploads it
const { rows: accounts } = await client.query(
  `select code, name, requires_partner, requires_movement, statement_type
     from dim_account where tenant_id = $1`,
  [TENANT],
);
const acct = new Map(accounts.map((a) => [a.code, a]));
const { rows: entities } = await client.query(
  `select code, local_currency from dim_entity where tenant_id = $1`,
  [TENANT],
);
const ccy = new Map(entities.map((e) => [e.code, e.local_currency.trim()]));

// --- retained earnings as the balancing figure
const plug = new Map();
for (const [entity, , , , amount] of TB) {
  plug.set(entity, (plug.get(entity) ?? 0) + amount);
}
const rows = [...TB];
for (const [entity, total] of plug) rows.push([entity, "3100", "199", "", -total]);

// --- static checks before anything is written
const problems = [];
for (const [entity, code, movement, partner, amount] of rows) {
  const a = acct.get(code);
  if (!a) problems.push(`${entity}/${code}: account does not exist`);
  else {
    if (a.requires_partner && !partner) problems.push(`${entity}/${code}: needs a partner`);
    if (a.requires_movement && !movement) problems.push(`${entity}/${code}: needs a movement type`);
    if (partner === entity) problems.push(`${entity}/${code}: partner equals entity`);
  }
  if (!ccy.has(entity)) problems.push(`${entity}: entity does not exist`);
  if (!Number.isFinite(amount)) problems.push(`${entity}/${code}: amount is not numeric`);
}
for (const [entity, total] of plug) {
  const check = rows.filter((r) => r[0] === entity).reduce((s, r) => s + r[4], 0);
  if (Math.round(check * 100) !== 0) problems.push(`${entity}: trial balance is out by ${check}`);
  void total;
}
if (problems.length) {
  console.error("PROBLEMS:\n" + problems.join("\n"));
  process.exit(1);
}

// --- write the files. Headers match stg_upload column names so the wizard's
// auto-mapper matches every one of them without any manual mapping.
const HEADER = [
  "entity_code",
  "account_code",
  "movement_code",
  "partner_code",
  "PROFIT_CENTER",
  "SEGMENT",
  "amount_lc",
  "amount_tc",
  "transaction_currency",
];

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (subset) =>
  [HEADER.join(",")]
    .concat(
      subset.map(([entity, code, movement, partner, amount]) =>
        // A transaction currency obliges a transaction amount: the validator
        // rejects the row otherwise. Here the transaction currency is the
        // entity's own, so the two amounts are the same.
        [entity, code, movement, partner, "#", "#", amount.toFixed(2), amount.toFixed(2), ccy.get(entity)]
          .map(csvCell)
          .join(","),
      ),
    )
    .join("\n") + "\n";

mkdirSync("sample-data", { recursive: true });

const order = ["PARENT", "SUB_US", "SUB_EU", "JV_SA", "ASSOC_IN"];
const sorted = rows.sort(
  (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || a[1].localeCompare(b[1]),
);

writeFileSync(`sample-data/trial-balance-${YEAR}-P${String(PERIOD).padStart(2, "0")}-all-entities.csv`, toCsv(sorted));
for (const entity of order) {
  writeFileSync(
    `sample-data/trial-balance-${YEAR}-P${String(PERIOD).padStart(2, "0")}-${entity}.csv`,
    toCsv(sorted.filter((r) => r[0] === entity)),
  );
}

// --- dry run through the real validator, so the files are proven not assumed
await client.query("begin");
// validate_upload_batch is tenant-scoped through current_tenant_id(), so the
// dry run has to look like an authenticated request.
await client.query(
  `select set_config('request.jwt.claims',
     json_build_object('sub', (select id::text from app_user where tenant_id = $1))::text, true)`,
  [TENANT],
);
const { rows: batch } = await client.query(
  `insert into upload_batch (tenant_id, file_name, version_id, fiscal_year, period, status)
   select $1, 'dry-run.csv', v.id, $2, $3, 'UPLOADED'
     from dim_version v where v.tenant_id = $1 and v.code = 'ACT01'
   returning id`,
  [TENANT, YEAR, PERIOD],
);
const batchId = batch[0].id;

let n = 0;
for (const [entity, code, movement, partner, amount] of sorted) {
  n += 1;
  await client.query(
    `insert into stg_upload (tenant_id, batch_id, row_no, raw, entity_code, account_code,
       movement_code, partner_code, zdim01, zdim02, amount_lc, amount_tc, transaction_currency)
     values ($1,$2,$3,'{}'::jsonb,$4,$5,nullif($6,''),nullif($7,''),'#','#',$8,$8,$9)`,
    [TENANT, batchId, n, entity, code, movement, partner, amount, ccy.get(entity)],
  );
}

const { rows: res } = await client.query(`select validate_upload_batch($1) as r`, [batchId]);
await client.query("rollback");
await client.end();

const r = res[0].r;
console.log(JSON.stringify({
  rows_written: sorted.length,
  total_rows: r.total_rows,
  valid_rows: r.valid_rows,
  error_rows: r.error_rows,
  errors_by_type: r.errors_by_type,
  trial_balance: r.trial_balance,
}, null, 2));

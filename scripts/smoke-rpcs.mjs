import { connect } from "./db-connect.mjs";

/**
 * Calls every RPC the application calls, the way the application calls it.
 *
 * Exists because "column reference task_run_id is ambiguous" shipped in all five
 * engine wrappers — including run_bcf, which had carried it since the original
 * build. Every end-to-end test drove the workers (run_bcf_entity,
 * run_ic_elimination, ...) or run_workflow_task, so the Consolidation Monitor
 * worked while every per-screen Run button was broken. A RETURNS TABLE column
 * name is a variable in plpgsql, and nothing catches that until the function is
 * actually executed.
 *
 * Everything runs inside a transaction that is rolled back, so this is safe
 * against a live workspace.
 *
 *   npm run db:smoke
 */
const TENANT = process.env.SMOKE_TENANT ?? "242e0719-8bf3-4eab-84de-be3c52a63cfa";
const YEAR = 2026;
const PERIOD = 12;

const client = await connect();
const results = [];

async function check(name, sql, params = []) {
  try {
    const { rows } = await client.query(sql, params);
    results.push({ name, ok: true, detail: `${rows.length} row(s)` });
    return rows;
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    return null;
  }
}

await client.query("begin");
await client.query(
  `select set_config('request.jwt.claims',
     json_build_object('sub',(select id::text from app_user
       where tenant_id = $1 order by created_at limit 1))::text, true)`,
  [TENANT],
);

const [{ version_id, group_id, entity_id, account_code }] = (
  await client.query(
    `select (select id from dim_version    where tenant_id=$1 and code='ACT01')  as version_id,
            (select id from dim_cons_group where tenant_id=$1 and code='GRP_WW') as group_id,
            (select id from dim_entity     where tenant_id=$1 and code='PARENT') as entity_id,
            (select code from dim_account  where tenant_id=$1 order by code limit 1) as account_code`,
    [TENANT],
  )
).rows;

if (!version_id || !group_id) {
  console.error("No demo data in this workspace — run seed_demo_dataset first.");
  await client.query("rollback");
  await client.end();
  process.exit(1);
}

const LEVELS = ["00", "01", "05", "10", "20", "30"];

// --- rule editors
await check("resolve_account_filter", `select * from resolve_account_filter($1, '{}'::jsonb)`, [TENANT]);

// --- engine wrappers, exactly as each screen's Run button calls them
await check("run_bcf", `select * from run_bcf($1, $2, $3, '{}'::uuid[])`, [version_id, YEAR, [entity_id]]);
await check("run_net_income", `select * from run_net_income($1, $2, $3, $4, '{}'::uuid[])`, [version_id, YEAR, PERIOD, [entity_id]]);
await check("check_fx_coverage", `select * from check_fx_coverage($1, $2, $3, $4)`, [version_id, YEAR, PERIOD, group_id]);
await check("run_currency_translation", `select * from run_currency_translation($1, $2, $3, $4, '{}'::uuid[])`, [version_id, YEAR, PERIOD, group_id]);
await check("run_ic", `select * from run_ic($1, $2, $3, $4, true)`, [version_id, YEAR, PERIOD, group_id]);
await check("run_coi", `select * from run_coi($1, $2, $3, $4, '{}'::uuid[])`, [version_id, YEAR, PERIOD, group_id]);

// --- verification and reporting
await check("verify_balance_sheet", `select * from verify_balance_sheet($1, $2, $3)`, [version_id, YEAR, PERIOD]);
await check("ic_matrix", `select * from ic_matrix($1, $2, $3, $4)`, [version_id, YEAR, PERIOD, group_id]);
await check("report_trial_balance", `select * from report_trial_balance($1, $2, $3, $4, $5, '{}'::uuid[])`, [version_id, YEAR, PERIOD, LEVELS, group_id]);
await check("report_statement", `select * from report_statement($1, $2, $3, 'AH_STD', $4, $5, '{}'::uuid[], $6, $3)`, [version_id, YEAR, PERIOD, LEVELS, group_id, YEAR - 1]);
await check("report_drilldown", `select * from report_drilldown($1, $2, $3, $4, $5, $6)`, [version_id, YEAR, PERIOD, LEVELS, group_id, account_code]);
await check("report_audit_trail", `select * from report_audit_trail($1, $2, $3)`, [version_id, YEAR, PERIOD]);
await check("report_cons_totals", `select * from report_cons_totals($1, $2, $3, $4, $5)`, [version_id, YEAR, PERIOD, LEVELS, group_id]);
await check("run_validations", `select * from run_validations($1, $2, $3, array['00','01'], $4, null, 'REPORTED')`, [version_id, YEAR, PERIOD, group_id]);

// --- workflow
const tpl = await check("seed_standard_workflow_template", `select seed_standard_workflow_template() as id`);
if (tpl?.[0]) {
  const run = await check("start_workflow_run", `select start_workflow_run($1, $2, $3, $4, $5) as id`, [tpl[0].id, version_id, YEAR, PERIOD, group_id]);
  if (run?.[0]) {
    const grid = await check("workflow_monitor", `select * from workflow_monitor($1)`, [run[0].id]);
    const first = grid?.find((c) => c.status === "PENDING" && c.deps_met);
    if (first) {
      await check("run_workflow_task", `select run_workflow_task($1)`, [first.task_run_id]);
    } else {
      // Say so rather than passing quietly: a check that skipped itself is the
      // whole reason this script exists.
      await client.query(
        `update task_run set status = 'PENDING'
          where id = (select task_run_id from workflow_monitor($1)
                       order by step_no, unit_code limit 1)`,
        [run[0].id],
      );
      const retry = await client.query(
        `select task_run_id from workflow_monitor($1) where status = 'PENDING' and deps_met
          order by step_no limit 1`,
        [run[0].id],
      );
      if (retry.rows[0]) {
        await check("run_workflow_task", `select run_workflow_task($1)`, [retry.rows[0].task_run_id]);
      } else {
        results.push({ name: "run_workflow_task", ok: false, detail: "SKIPPED — no runnable cell" });
      }
    }
  }
}

// --- user administration
await check("admin_list_users", `select * from admin_list_users()`);
await check("complete_password_change", `select complete_password_change()`);

// --- housekeeping
await check("refresh_cons_totals", `select refresh_cons_totals()`);

await client.query("rollback");
await client.end();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.name.padEnd(32)} ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

import { connect } from "./db-connect.mjs";

/**
 * Fails if any function contains a DELETE or UPDATE without a WHERE clause.
 *
 * Supabase preloads pg_safeupdate for the `authenticator` role, which is what
 * PostgREST connects as, so every call through the API refuses such a statement
 * with "DELETE requires a WHERE clause" — even against a temporary table the
 * function created moments earlier.
 *
 * The migration and verification scripts connect as the pooler superuser, for
 * which the library is not preloaded and which cannot load it on demand
 * (supautils restricts it). So this class of bug runs clean from SQL and fails
 * only in the running application. Currency translation shipped with exactly
 * one of these; this check exists so the next one is caught first.
 *
 *   npm run db:check
 */
const client = await connect();

const { rows } = await client.query(`
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
   order by p.proname`);

const offences = [];

for (const { proname, def } of rows) {
  // Strip line comments so a commented-out example never trips the check.
  const body = def.replace(/--[^\n]*/g, " ");

  // Statement level, not line level: a bare DELETE sharing a line with other
  // statements is just as fatal, and plpgsql bodies are often written that way.
  for (const raw of body.split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!stmt) continue;

    // Drop anything before the verb, so `begin ... delete from x` still matches.
    const tail = stmt.replace(/^.*?(?=\bdelete\s+from\b|\bupdate\s+\S+\s+set\b)/is, "");
    if (!tail) continue;

    const bareDelete = /^delete\s+from\s+[\w."]+$/i.test(tail);
    const bareUpdate = /^update\s+[\w."]+\s+set\b/i.test(tail) && !/\bwhere\b/i.test(tail);
    if (bareDelete || bareUpdate) {
      offences.push({ proname, statement: tail.slice(0, 120) });
    }
  }
}

if (offences.length) {
  console.error("Unqualified DELETE/UPDATE — pg_safeupdate rejects these through the API:\n");
  for (const o of offences) console.error(`  ${o.proname}: ${o.statement}`);
  console.error("\nAdd a WHERE clause, or use TRUNCATE for a temporary table.");
  await client.end();
  process.exit(1);
}

console.log(`checked ${rows.length} functions — no unqualified DELETE or UPDATE`);
await client.end();

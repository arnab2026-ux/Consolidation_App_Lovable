import { readFileSync } from "node:fs";

import { connect } from "./db-connect.mjs";

// Applies one .sql migration file inside a transaction and records it in
// supabase_migrations.schema_migrations so re-runs are skipped.
//   npm run db:apply -- supabase/migrations/<file>.sql
//   npm run db:apply -- <file>.sql --force   (re-apply an already-recorded file)
const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/db-apply.mjs <migration.sql> [--force]");
  process.exit(1);
}
const force = flags.includes("--force");
const version = (file.split(/[\/]/).pop() ?? file).replace(/\.sql$/, "");
const sql = readFileSync(file, "utf8");

const client = await connect();
try {
  await client.query(`create schema if not exists supabase_migrations`);
  await client.query(`create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      applied_at timestamptz not null default now())`);

  const { rows } = await client.query(
    `select 1 from supabase_migrations.schema_migrations where version = $1`,
    [version],
  );
  if (rows.length && !force) {
    console.log(`already applied: ${version} (use --force to re-apply)`);
    process.exit(0);
  }

  await client.query("begin");
  await client.query(sql);
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name)
     values ($1, $2)
     on conflict (version) do update set applied_at = now()`,
    [version, file],
  );
  await client.query("commit");
  console.log(`applied: ${version}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`FAILED: ${version}\n${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

import { writeFileSync } from "node:fs";

import { connect } from "./db-connect.mjs";

// Dumps the full public schema to a .sql file. Used to produce the baseline
// and to re-snapshot the schema after a batch of migrations.
//   npm run db:dump -- supabase/migrations/<name>.sql

const Q = {
  tables: `select string_agg(stmt, E'\n\n' order by tbl) d from (
    select c.relname tbl, 'create table if not exists public.'||c.relname||' ('||E'\n  '||
      string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||
        case when a.attgenerated='s' then ' generated always as ('||pg_get_expr(ad.adbin,ad.adrelid)||') stored'
             when ad.adbin is not null then ' default '||pg_get_expr(ad.adbin,ad.adrelid) else '' end||
        case when a.attnotnull then ' not null' else '' end, E',\n  ' order by a.attnum)||E'\n);' stmt
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum
    where n.nspname='public' and c.relkind='r' group by c.relname) t`,
  sequences: `select string_agg('create sequence if not exists public.'||sequencename||';', E'\n' order by sequencename) d
    from pg_sequences where schemaname='public'`,
  constraints: `select string_agg('alter table public.'||c.relname||' add constraint '||con.conname||' '||pg_get_constraintdef(con.oid)||';', E'\n'
    order by case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end, c.relname, con.conname) d
    from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'`,
  indexes: `select string_agg(indexdef||';', E'\n' order by indexname) d from pg_indexes
    where schemaname='public' and indexname not in (select conname from pg_constraint)`,
  functions: `select string_agg(pg_get_functiondef(p.oid)||';', E'\n\n' order by p.proname) d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
  views: `select string_agg('create or replace view public.'||viewname||' with (security_invoker=true) as '||definition, E'\n\n' order by viewname) d
    from pg_views where schemaname='public'`,
  triggers: `select string_agg(pg_get_triggerdef(t.oid)||';', E'\n' order by tgname) d
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal`,
  rls: `select string_agg('alter table public.'||c.relname||' enable row level security;', E'\n' order by c.relname) d
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity`,
  policies: `select string_agg('create policy '||pol.polname||' on public.'||c.relname||' for '||
      case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end||
      coalesce(' using ('||pg_get_expr(pol.polqual,pol.polrelid)||')','')||
      coalesce(' with check ('||pg_get_expr(pol.polwithcheck,pol.polrelid)||')','')||';', E'\n' order by c.relname, pol.polname) d
    from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'`,
};

const client = await connect();

const out = [];
const push = (title, sql) => out.push(`-- ${"=".repeat(70)}\n-- ${title}\n-- ${"=".repeat(70)}\n\n${sql}\n`);

const order = [
  ["EXTENSIONS", null],
  ["SEQUENCES", "sequences"],
  ["TABLES", "tables"],
  ["CONSTRAINTS (primary keys, unique, check, foreign keys)", "constraints"],
  ["INDEXES", "indexes"],
  ["FUNCTIONS", "functions"],
  ["TRIGGERS", "triggers"],
  ["VIEWS", "views"],
  ["ROW LEVEL SECURITY", "rls"],
  ["POLICIES", "policies"],
];

for (const [title, key] of order) {
  if (!key) { push(title, 'create extension if not exists "pgcrypto";'); continue; }
  const { rows } = await client.query(Q[key]);
  push(title, rows[0]?.d ?? "-- none");
}
await client.end();

const header = `-- Baseline schema: state of the database as built through Prompt 11
-- of the consolidation build pack. Reconstructed from the live project
-- on ${new Date().toISOString().slice(0, 10)}; no migration history existed
-- because all prior SQL was pasted straight into the Supabase SQL editor.
--
-- This file is a RECORD and a rebuild script for a fresh project. It is
-- already applied to the live database - do not re-run it there.

`;
writeFileSync(process.argv[2], header + out.join("\n"));
console.error("written:", process.argv[2]);

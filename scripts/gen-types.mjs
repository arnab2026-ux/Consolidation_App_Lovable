import { writeFileSync, readFileSync } from "node:fs";

import { connect } from "./db-connect.mjs";

// Regenerates src/integrations/supabase/types.ts from the live database,
// including Views and Functions (which the Lovable-era types were missing).
// Run after every migration:  npm run db:types
const TYPES_FILE = process.argv[2] ?? "src/integrations/supabase/types.ts";

// pg base type -> TS type. Anything unmapped falls back to string.
const SCALARS = {
  bool: "boolean",
  int2: "number", int4: "number", int8: "number",
  float4: "number", float8: "number", numeric: "number",
  json: "Json", jsonb: "Json", record: "Json",
  void: "undefined",
};
const tsType = (pgType) => {
  const arr = pgType.startsWith("_");
  const base = arr ? pgType.slice(1) : pgType;
  const t = SCALARS[base] ?? "string";
  return arr ? `${t}[]` : t;
};

const client = await connect();

const { rows: cols } = await client.query(`
  select c.relname as rel, c.relkind, a.attname as col, t.typname as pgtype,
         a.attnotnull as notnull, (ad.adbin is not null) as has_default,
         (a.attgenerated = 's') as generated, a.attnum
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r','v','m')
  order by c.relname, a.attnum`);

const { rows: funcs } = await client.query(`
  select p.proname, p.proretset, rt.typname as rettype,
         p.pronargs, p.pronargdefaults,
         coalesce(p.proallargtypes::oid[], p.proargtypes::oid[]) as argtypes,
         p.proargnames::text[] as proargnames, p.proargmodes::text[] as proargmodes,
         pg_get_function_identity_arguments(p.oid) as ident
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type rt on rt.oid = p.prorettype
  where n.nspname = 'public' and p.prokind = 'f'
    and rt.typname not in ('trigger','event_trigger')
  order by p.proname`);

const typeName = new Map();
{
  const { rows } = await client.query(`select oid, typname from pg_type`);
  for (const r of rows) typeName.set(String(r.oid), r.typname);
}

// group columns by relation
const rels = new Map();
for (const c of cols) {
  if (!rels.has(c.rel)) rels.set(c.rel, { kind: c.relkind, cols: [] });
  rels.get(c.rel).cols.push(c);
}

const ind = (n) => "  ".repeat(n);
const emitRel = (name, def, isView) => {
  const L = [];
  L.push(`${ind(3)}${name}: {`);
  L.push(`${ind(4)}Row: {`);
  for (const c of def.cols)
    L.push(`${ind(5)}${c.col}: ${tsType(c.pgtype)}${c.notnull ? "" : " | null"}`);
  L.push(`${ind(4)}}`);
  if (!isView) {
    L.push(`${ind(4)}Insert: {`);
    for (const c of def.cols) {
      if (c.generated) continue;
      const optional = !c.notnull || c.has_default;
      L.push(`${ind(5)}${c.col}${optional ? "?" : ""}: ${tsType(c.pgtype)}${c.notnull ? "" : " | null"}`);
    }
    L.push(`${ind(4)}}`);
    L.push(`${ind(4)}Update: {`);
    for (const c of def.cols) {
      if (c.generated) continue;
      L.push(`${ind(5)}${c.col}?: ${tsType(c.pgtype)}${c.notnull ? "" : " | null"}`);
    }
    L.push(`${ind(4)}}`);
  }
  L.push(`${ind(4)}Relationships: []`);
  L.push(`${ind(3)}}`);
  return L.join("\n");
};

const tables = [...rels].filter(([, d]) => d.kind === "r").sort();
const views = [...rels].filter(([, d]) => d.kind !== "r").sort();

const out = [];
out.push(`export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {`);
out.push(tables.map(([n, d]) => emitRel(n, d, false)).join("\n"));
out.push(`${ind(2)}}`);
out.push(`${ind(2)}Views: {`);
out.push(views.length ? views.map(([n, d]) => emitRel(n, d, true)).join("\n") : `${ind(3)}[_ in never]: never`);
out.push(`${ind(2)}}`);

// Functions
out.push(`${ind(2)}Functions: {`);
if (!funcs.length) out.push(`${ind(3)}[_ in never]: never`);
else {
  const seen = new Set();
  for (const f of funcs) {
    if (seen.has(f.proname)) continue; // first overload wins
    seen.add(f.proname);
    const argTypes = f.argtypes ?? [];
    const argNames = f.proargnames ?? [];
    const modes = f.proargmodes ?? null;
    const inArgs = [];
    const outArgs = [];
    for (let i = 0; i < argTypes.length; i++) {
      const mode = modes ? modes[i] : "i";
      const nm = argNames[i] ?? `arg${i}`;
      const ty = tsType(typeName.get(String(argTypes[i])) ?? "text");
      if (mode === "o" || mode === "t") outArgs.push([nm, ty]);
      else inArgs.push([nm, ty, false]);
    }
    // trailing IN args with DEFAULTs are optional
    const nd = f.pronargdefaults ?? 0;
    for (let k = inArgs.length - nd; k < inArgs.length; k++) if (k >= 0) inArgs[k][2] = true;
    out.push(`${ind(3)}${f.proname}: {`);
    if (!inArgs.length) out.push(`${ind(4)}Args: Record<PropertyKey, never>`);
    else {
      out.push(`${ind(4)}Args: {`);
      for (const [nm, ty, opt] of inArgs) out.push(`${ind(5)}${nm}${opt ? "?" : ""}: ${ty}`);
      out.push(`${ind(4)}}`);
    }
    let ret;
    if (outArgs.length) {
      ret = `{\n${outArgs.map(([nm, ty]) => `${ind(6)}${nm}: ${ty}`).join("\n")}\n${ind(5)}}`;
      if (f.proretset) ret += "[]";
    } else {
      ret = tsType(f.rettype);
      if (f.proretset) ret += "[]";
    }
    out.push(`${ind(4)}Returns: ${ret}`);
    out.push(`${ind(3)}}`);
  }
}
out.push(`${ind(2)}}`);
out.push(`${ind(2)}Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}`);

// keep the existing generic helper tail (Tables<>, TablesInsert<>, ...)
const existing = readFileSync(TYPES_FILE, "utf8");
const tailStart = existing.indexOf("type DefaultSchema = Database[");
if (tailStart < 0) throw new Error("could not locate helper tail in existing types file");
const tail = existing.slice(tailStart);

writeFileSync(TYPES_FILE, out.join("\n") + "\n\n" + tail);
await client.end();
console.error(`tables=${tables.length} views=${views.length} functions=${new Set(funcs.map(f=>f.proname)).size}`);

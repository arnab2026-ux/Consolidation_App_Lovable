import { Client } from "pg";

/**
 * Direct Postgres connection to the Supabase project.
 *
 * Set SUPABASE_DB_URL in .env.local (never commit it):
 *   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *
 * The Supabase CLI equivalents of these scripts require Docker; these do not.
 */
export async function connect() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Copy .env.example to .env.local and fill it in, " +
        "then run with: node --env-file=.env.local scripts/<script>.mjs",
    );
  }
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  return client;
}

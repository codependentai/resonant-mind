import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.PG_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('PG_URL or DATABASE_URL is required');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationDir = join(here, '..', 'migrations', 'postgres');
const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
const lockId = 741927401;

try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [lockId]);

  const state = await client.query(`
    SELECT
      to_regclass('public.schema_migrations') IS NOT NULL AS has_ledger,
      to_regclass('public.entities') IS NOT NULL AS has_entities
  `);
  if (!state.rows[0].has_ledger && state.rows[0].has_entities) {
    throw new Error('Existing untracked schema detected. Back up the database and use the documented v3.2-to-v4 upgrade path; the fresh-install runner will not guess.');
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const sql = await readFile(join(migrationDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Checksum mismatch for applied migration ${file}`);
      console.log(`${file} already applied`);
      continue;
    }

    console.log(`${file} applying`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Postgres migrations complete');
} finally {
  try { await client.query('SELECT pg_advisory_unlock($1)', [lockId]); } catch {}
  await client.end().catch(() => {});
}

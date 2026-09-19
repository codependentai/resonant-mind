import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/mind-helpers', () => ({
  getEmbedding: vi.fn(async () => Array(768).fill(0)),
}));

import { createD1Adapter } from '../src/adapter';
import { createVectorAdapter } from '../src/vectors';
import { handleMindWrite } from '../src/legacy-tools/write';
import { handleMindRead } from '../src/legacy-tools/read';
import { handleActiveContext } from '../src/regions/active';
import { editObservation } from '../src/shared/surgery';
import type { Env } from '../src/types';

const connectionString = process.env.TEST_DATABASE_URL;
const runDatabaseTests = Boolean(connectionString);
const { Client } = pg;
let migrationClient: pg.Client | undefined;
let env: Env;

async function applyFreshV4Migrations(client: pg.Client) {
  const migrationDir = join(process.cwd(), 'migrations', 'postgres');
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();

  const existing = await client.query(`
    SELECT to_regclass('public.entities') AS entities,
           to_regclass('public.schema_migrations') AS schema_migrations
  `);
  if (existing.rows[0].entities || existing.rows[0].schema_migrations) {
    throw new Error('TEST_DATABASE_URL must point to a fresh disposable database');
  }

  await client.query(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const sql = await readFile(join(migrationDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)',
        [file, checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  expect(files.length).toBeGreaterThan(0);
  const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  expect(applied.rows.map((row) => row.version)).toEqual(files);
}

function makeEnv(url: string): Env {
  return {
    DB: createD1Adapter({ connectionString: url }),
    VECTORS: createVectorAdapter(url),
    GEMINI_API_KEY: 'integration-test-no-network',
  } as unknown as Env;
}

describe.runIf(runDatabaseTests)('fresh-v4 PostgreSQL contracts', () => {
  beforeAll(async () => {
    migrationClient = new Client({ connectionString });
    await migrationClient.connect();
    await applyFreshV4Migrations(migrationClient);
    env = makeEnv(connectionString!);
  }, 120_000);

  afterAll(async () => {
    await migrationClient?.end();
  });

  it('records the rescued_at migration in the fresh ledger and schema', async () => {
    const ledger = await migrationClient!.query(
      `SELECT version FROM schema_migrations WHERE version = '0018_rescued_at.sql'`,
    );
    expect(ledger.rows).toEqual([{ version: '0018_rescued_at.sql' }]);

    const column = await migrationClient!.query(`
      SELECT data_type, col_description('observations'::regclass, ordinal_position::integer) AS comment
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'observations'
        AND column_name = 'rescued_at'
    `);
    expect(column.rows).toEqual([{
      data_type: 'timestamp with time zone',
      comment: expect.stringContaining('pending'),
    }]);
  }, 60_000);

  it('writes a standalone observation and reads its version history through the released schema', async () => {
    const seeded = await migrationClient!.query(
      `INSERT INTO entities (name, entity_type, primary_context)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['Fresh v4 contract', 'concept', 'seeded'],
    );
    const seededEntityId = Number(seeded.rows[0].id);

    const writeResult = await handleMindWrite(env, {
      type: 'observation',
      entity_name: 'Fresh v4 contract',
      observations: ['before edit'],
      context: 'research',
    });
    expect(writeResult).toContain("Added 1 observations to 'Fresh v4 contract'");

    const entities = await migrationClient!.query(
      'SELECT id FROM entities WHERE name = $1',
      ['Fresh v4 contract'],
    );
    expect(entities.rows).toEqual([{ id: seededEntityId }]);

    const stored = await migrationClient!.query(
      `SELECT id, entity_id, content
       FROM observations
       WHERE entity_id = $1 AND content = $2`,
      [seededEntityId, 'before edit'],
    );
    expect(stored.rows).toEqual([{
      id: expect.any(Number),
      entity_id: seededEntityId,
      content: 'before edit',
    }]);
    const observationId = Number(stored.rows[0].id);

    const persistedVector = await migrationClient!.query(
      `SELECT id, source_type, source_id, content, metadata, vector_dims(embedding) AS dimensions
       FROM embeddings
       WHERE id = $1`,
      [`obs-${seededEntityId}-${observationId}`],
    );
    expect(persistedVector.rows).toEqual([{
      id: `obs-${seededEntityId}-${observationId}`,
      source_type: 'observation',
      source_id: observationId,
      content: 'before edit',
      dimensions: 768,
      metadata: {
        source: 'observation',
        entity: 'Fresh v4 contract',
        content: 'before edit',
        context: 'research',
        weight: 'medium',
        certainty: 'believed',
        observation_source: 'conversation',
        added_at: expect.any(String),
      },
    }]);

    const editResult = await editObservation(env, observationId, {
      content: 'after edit',
      weight: 'heavy',
      emotion: 'certain',
    });
    expect(editResult).toMatchObject({ found: true, versionNum: 1 });

    const readResult = JSON.parse(await handleMindRead(env, {
      scope: 'observation',
      observation_id: observationId,
    }));
    expect(readResult).toMatchObject({
      id: observationId,
      content: 'after edit',
      edit_history: [{
        previous_content: 'before edit',
        previous_weight: 'medium',
        previous_emotion: null,
      }],
    });
    expect(readResult.edit_history[0].changed_at).toBeTruthy();
  }, 60_000);

  it('distinguishes context clear by ID, scope, and all on PostgreSQL', async () => {
    await migrationClient!.query(`
      INSERT INTO context_entries (id, scope, content) VALUES
        ('ctx-id', 'session', 'one'),
        ('ctx-scope', 'session', 'two'),
        ('ctx-other', 'project', 'three')
    `);

    expect(await handleActiveContext(env, { action: 'clear', id: 'ctx-missing' }))
      .toBe('Context entry not found: ctx-missing');
    expect(await handleActiveContext(env, { action: 'clear', id: 'ctx-id' }))
      .toBe('Context entry deleted: ctx-id');
    expect(await handleActiveContext(env, { action: 'clear', scope: 'session' }))
      .toBe("Context scope 'session' cleared (1 deleted)");

    await migrationClient!.query(
      `INSERT INTO context_entries (id, scope, content) VALUES ('ctx-final', 'session', 'four')`,
    );
    expect(await handleActiveContext(env, { action: 'clear' }))
      .toBe('All context entries cleared (2 deleted)');

    const remaining = await migrationClient!.query('SELECT COUNT(*)::integer AS count FROM context_entries');
    expect(remaining.rows[0].count).toBe(0);
  }, 60_000);
});

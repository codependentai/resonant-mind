import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recalcNoveltyScores, decayUnaccessed } from '../src/daemon/novelty';
import { identifyOrphans } from '../src/daemon/orphans';
import { runDeepArchivePass } from '../src/daemon/archive';
import { consolidateRelatedObservations } from '../src/daemon/consolidation';
import { handleApiOrphans } from '../src/http/handlers/orphans';
import { rescueObservation } from '../src/shared/archive-observation';
import type { Env } from '../src/types';

function recordingEnv(
  results: Array<Record<string, unknown>> | ((sql: string) => Array<Record<string, unknown>>) = [],
) {
  const statements: string[] = [];
  const DB = {
    prepare(sql: string) {
      statements.push(sql);
      const statement = {
        bind() { return statement; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async all() { return { results: typeof results === 'function' ? results(sql) : results }; },
      };
      return statement;
    },
  };
  return { env: { DB } as unknown as Env, statements };
}

const pendingRescuePredicate = /NOT\s*\(\s*(?:o\.)?rescued_at IS NOT NULL\s+AND\s+(?:o\.)?last_surfaced_at IS NULL\s*\)/i;

describe('rescue persistence', () => {
  it('stamps rescued_at when restoring an observation', async () => {
    const { env, statements } = recordingEnv();

    await rescueObservation(env, 42);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/rescued_at\s*=\s*NOW\(\)/i);
  });

  it('stamps rescued_at through the orphan HTTP rescue path', async () => {
    const { env, statements } = recordingEnv();

    const response = await handleApiOrphans(
      new Request('https://mind.example/api/dreams/orphans/42/surface', { method: 'POST' }),
      env,
      ['api', 'orphans', '42', 'surface'],
    );

    expect(response.status).toBe(200);
    expect(statements.find((sql) => /UPDATE observations/i.test(sql))).toMatch(/rescued_at\s*=\s*NOW\(\)/i);
  });

  it('keeps the orphan queued when the HTTP rescue update fails', async () => {
    let orphanDeleteAttempts = 0;
    const DB = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async run() {
            if (/DELETE FROM orphan_observations/i.test(sql)) orphanDeleteAttempts += 1;
            if (/UPDATE observations/i.test(sql)) throw new Error('rescue update failed');
            return { success: true, meta: { changes: 1 } };
          },
        };
        return statement;
      },
    };
    const env = { DB } as unknown as Env;

    await expect(handleApiOrphans(
      new Request('https://mind.example/api/dreams/orphans/42/surface', { method: 'POST' }),
      env,
      ['api', 'orphans', '42', 'surface'],
    )).rejects.toThrow('rescue update failed');
    expect(orphanDeleteAttempts).toBe(0);
  });

  it('holds pending rescues out of novelty recalculation and access decay', async () => {
    const { env, statements } = recordingEnv();

    await recalcNoveltyScores(env);
    await decayUnaccessed(env);

    const observationUpdates = statements.filter((sql) => /UPDATE observations/i.test(sql));
    expect(observationUpdates).toHaveLength(2);
    for (const sql of observationUpdates) expect(sql).toMatch(pendingRescuePredicate);
  });

  it('does not requeue a pending rescue as an orphan', async () => {
    const { env, statements } = recordingEnv();

    await identifyOrphans(env);

    expect(statements[0]).toMatch(pendingRescuePredicate);
  });

  it('holds pending rescues out of the production deep-archive selection query', async () => {
    const { env, statements } = recordingEnv();

    await runDeepArchivePass(env);

    const candidateQuery = statements.find((sql) => /SELECT id FROM \(/i.test(sql));
    expect(candidateQuery).toMatch(pendingRescuePredicate);
    expect(candidateQuery).not.toMatch(/(?:o\.)?rescued_at IS NULL/i);
  });

  it('holds pending rescues out of the production consolidation candidate queries', async () => {
    const { env, statements } = recordingEnv((sql) => (
      /COUNT\(\*\) as obs_count/i.test(sql) ? [{ id: 7, name: 'Rescue contract' }] : []
    ));

    await consolidateRelatedObservations(env);

    const entityCandidateQuery = statements.find((sql) => /COUNT\(\*\) as obs_count/i.test(sql));
    expect(entityCandidateQuery).toMatch(pendingRescuePredicate);
    expect(entityCandidateQuery).not.toMatch(/(?:o\.)?rescued_at IS NULL/i);

    const observationCandidateQuery = statements.find((sql) => /SELECT id, content, weight, emotion/i.test(sql));
    expect(observationCandidateQuery).toMatch(pendingRescuePredicate);
    expect(observationCandidateQuery).not.toMatch(/(?:o\.)?rescued_at IS NULL/i);
  });

  it('adds rescued_at through append-only migration 0018 with a documented contract', async () => {
    const sql = await readFile(join(process.cwd(), 'migrations', 'postgres', '0018_rescued_at.sql'), 'utf8');

    expect(sql).toMatch(/ALTER TABLE observations\s+ADD COLUMN IF NOT EXISTS rescued_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/COMMENT ON COLUMN observations\.rescued_at/i);
  });
});

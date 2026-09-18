import { describe, expect, it, vi } from 'vitest';
import { handleMindRead } from '../src/legacy-tools/read';
import type { Env } from '../src/types';

function observationReadEnv() {
  const queries: string[] = [];
  const observation = {
    id: 7,
    content: 'current words',
    context: 'default',
    emotion: 'steady',
    weight: 'medium',
    certainty: 'believed',
    source: 'conversation',
    charge: 'fresh',
    sit_count: 0,
    surface_count: 0,
    access_count: 0,
    novelty_score: 1,
    entity_name: 'Contract test',
    entity_type: 'concept',
    entity_salience: 'active',
  };

  const DB = {
    prepare(sql: string) {
      queries.push(sql);
      const statement = {
        bind: () => statement,
        first: async () => {
          if (sql.includes('FROM observations o')) return observation;
          return null;
        },
        all: async () => {
          if (sql.includes('FROM observation_sits')) return { results: [] };
          if (sql.includes('FROM observation_versions')) {
            // Model the released fresh-v4 table: physical columns are
            // version_num/content/weight/emotion/edited_at only.
            for (const staleColumn of ['previous_content', 'previous_weight', 'previous_emotion', 'changed_at']) {
              if (new RegExp(`(?:SELECT|,)\\s*${staleColumn}\\b`, 'i').test(sql)) {
                throw new Error(`column ${staleColumn} does not exist`);
              }
            }
            expect(sql).toMatch(/content\s+AS\s+previous_content/i);
            expect(sql).toMatch(/weight\s+AS\s+previous_weight/i);
            expect(sql).toMatch(/emotion\s+AS\s+previous_emotion/i);
            expect(sql).toMatch(/edited_at\s+AS\s+changed_at/i);
            expect(sql).toMatch(/ORDER BY\s+edited_at\s+DESC/i);
            return {
              results: [{
                previous_content: 'old words',
                previous_weight: 'light',
                previous_emotion: 'curious',
                changed_at: '2026-09-18T10:00:00.000Z',
              }],
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    },
  };

  return {
    env: { DB } as unknown as Env,
    queries,
  };
}

describe('direct observation read', () => {
  it('reads the fresh-v4 version columns while preserving the legacy edit_history shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { env } = observationReadEnv();

    const result = JSON.parse(await handleMindRead(env, { scope: 'observation', observation_id: 7 }));

    expect(result.error).toBeUndefined();
    expect(result.edit_history).toEqual([{
      previous_content: 'old words',
      previous_weight: 'light',
      previous_emotion: 'curious',
      changed_at: '2026-09-18T10:00:00.000Z',
    }]);
  });
});

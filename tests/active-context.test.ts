import { describe, expect, it } from 'vitest';
import { handleActiveContext } from '../src/regions/active';
import type { Env } from '../src/types';

type ContextEntry = { id: string; scope: string; content: string };

function contextEnv(seed: ContextEntry[]) {
  const entries = new Map(seed.map((entry) => [entry.id, entry]));
  const DB = {
    prepare(sql: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async run() {
          let changes = 0;
          if (/DELETE FROM context_entries WHERE id = \?/i.test(sql)) {
            changes = entries.delete(String(statement.values[0])) ? 1 : 0;
          } else if (/DELETE FROM context_entries WHERE scope = \?/i.test(sql)) {
            const scope = String(statement.values[0]);
            for (const [id, entry] of entries) {
              if (entry.scope === scope) {
                entries.delete(id);
                changes++;
              }
            }
          } else if (/DELETE FROM context_entries\s*$/i.test(sql.trim())) {
            changes = entries.size;
            entries.clear();
          }
          return { success: true, meta: { changes } };
        },
        async first() {
          if (/COUNT\(\*\)/i.test(sql)) return { count: entries.size };
          return null;
        },
        async all() {
          return { results: [...entries.values()] };
        },
      };
      return statement;
    },
  };

  return { env: { DB } as unknown as Env, entries };
}

describe('active_context clear', () => {
  it('reports a requested ID as not found when no row was deleted', async () => {
    const { env } = contextEnv([]);

    const result = await handleActiveContext(env, { action: 'clear', id: 'ctx-missing' });

    expect(result).toBe('Context entry not found: ctx-missing');
  });

  it('clears one existing entry by ID', async () => {
    const { env, entries } = contextEnv([
      { id: 'ctx-1', scope: 'session', content: 'one' },
      { id: 'ctx-2', scope: 'session', content: 'two' },
    ]);

    const result = await handleActiveContext(env, { action: 'clear', id: 'ctx-1' });

    expect(result).toBe('Context entry deleted: ctx-1');
    expect([...entries.keys()]).toEqual(['ctx-2']);
  });

  it('clears only the named scope and reports the deletion count', async () => {
    const { env, entries } = contextEnv([
      { id: 'ctx-1', scope: 'session', content: 'one' },
      { id: 'ctx-2', scope: 'session', content: 'two' },
      { id: 'ctx-3', scope: 'project', content: 'three' },
    ]);

    const result = await handleActiveContext(env, { action: 'clear', scope: 'session' });

    expect(result).toBe("Context scope 'session' cleared (2 deleted)");
    expect([...entries.keys()]).toEqual(['ctx-3']);
  });

  it('clears all entries only when neither ID nor scope is supplied', async () => {
    const { env, entries } = contextEnv([
      { id: 'ctx-1', scope: 'session', content: 'one' },
      { id: 'ctx-2', scope: 'project', content: 'two' },
    ]);

    const result = await handleActiveContext(env, { action: 'clear' });

    expect(result).toBe('All context entries cleared (2 deleted)');
    expect(entries.size).toBe(0);
  });

  it('rejects an ambiguous clear selector rather than silently preferring ID', async () => {
    const { env, entries } = contextEnv([
      { id: 'ctx-1', scope: 'session', content: 'one' },
    ]);

    const result = await handleActiveContext(env, { action: 'clear', id: 'ctx-1', scope: 'session' });

    expect(result).toBe('Clear context by either id or scope, not both.');
    expect(entries.size).toBe(1);
  });
});

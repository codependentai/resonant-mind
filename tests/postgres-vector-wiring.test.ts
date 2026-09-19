import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL v4 integration wiring', () => {
  it('uses the production pgvector adapter and SQL readback instead of a vector mock', async () => {
    const source = await readFile(join(process.cwd(), 'tests', 'postgres-v4.integration.test.ts'), 'utf8');

    expect(source).toMatch(/import \{ createVectorAdapter \} from ['"]\.\.\/src\/vectors['"]/);
    expect(source).toMatch(/VECTORS:\s*createVectorAdapter\(url\)/);
    expect(source).toMatch(/FROM embeddings/);
    expect(source).toMatch(/source_type/);
    expect(source).toMatch(/source_id/);
    expect(source).toMatch(/metadata/);
    expect(source).not.toMatch(/vectorUpsert/);
  });
});
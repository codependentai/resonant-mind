import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/embeddings', () => ({
  getImageEmbedding: vi.fn(async () => [0.25]),
  getEmbedding: vi.fn(async () => [0.5]),
}));

import { getEmbedding, getImageEmbedding } from '../src/embeddings';
import { handleMindStoreImage } from '../src/legacy-tools/store-image';
import type { Env } from '../src/types';

const png = new Uint8Array(readFileSync(
  fileURLToPath(new URL('./fixtures/images/valid.png', import.meta.url)),
));

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function testEnv(
  put: ReturnType<typeof vi.fn>,
  options: {
    deleteObject?: ReturnType<typeof vi.fn>;
    dbRun?: ReturnType<typeof vi.fn>;
    vectorUpsert?: ReturnType<typeof vi.fn>;
  } = {},
): Env {
  const dbRun = options.dbRun ?? vi.fn(async () => ({ meta: { last_row_id: 7 } }));
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          run: dbRun,
          first: async () => null,
        }),
      }),
    },
    R2_IMAGES: { put, delete: options.deleteObject ?? vi.fn(async () => undefined) },
    VECTORS: { upsert: options.vectorUpsert ?? vi.fn(async () => undefined) },
    GEMINI_API_KEY: 'test-key',
  } as unknown as Env;
}

describe('mind_store_image ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getImageEmbedding).mockResolvedValue([0.25]);
    vi.mocked(getEmbedding).mockResolvedValue([0.5]);
  });

  it('derives the stored extension and metadata from bytes, not mime_type', async () => {
    const put = vi.fn(async () => undefined);
    const result = await handleMindStoreImage(testEnv(put), {
      action: 'store',
      image_data: base64(png),
      mime_type: 'image/svg+xml',
      filename: 'memory.jpg',
      description: 'A memory',
    });

    expect(result).toContain('[R2: image/png');
    expect(put).toHaveBeenCalledOnce();
    const [key, bytes, options] = put.mock.calls[0];
    expect(key).toMatch(/_memory_jpg_[0-9a-f-]{36}\.png$/);
    expect(bytes).toEqual(png);
    expect(options).toEqual({ httpMetadata: { contentType: 'image/png' } });
  });

  it('gives same-name same-day stores distinct keys without overwriting', async () => {
    const objects = new Map<string, Uint8Array>();
    const put = vi.fn(async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    });
    const env = testEnv(put);
    const params = {
      action: 'store',
      image_data: base64(png),
      filename: 'same.png',
      description: 'Same memory',
    };

    const first = await handleMindStoreImage(env, params);
    const second = await handleMindStoreImage(env, params);

    expect(first).toMatch(/^Image stored/);
    expect(second).toMatch(/^Image stored/);
    expect(put.mock.calls[0][0]).not.toBe(put.mock.calls[1][0]);
    expect(objects.size).toBe(2);
  });

  it('deletes the new R2 object when all pre-commit embedding methods fail', async () => {
    vi.mocked(getImageEmbedding).mockRejectedValue(new Error('multimodal unavailable'));
    vi.mocked(getEmbedding).mockRejectedValue(new Error('text unavailable'));
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);
    const dbRun = vi.fn(async () => ({ meta: { last_row_id: 7 } }));

    await expect(handleMindStoreImage(testEnv(put, { deleteObject, dbRun }), {
      action: 'store', image_data: base64(png), filename: 'embedding.png', description: 'Embedding failure',
    })).rejects.toThrow(/text unavailable/);

    expect(deleteObject).toHaveBeenCalledWith(put.mock.calls[0][0]);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('deletes the new R2 object when the database insert fails', async () => {
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);
    const dbRun = vi.fn(async () => { throw new Error('db unavailable'); });

    await expect(handleMindStoreImage(testEnv(put, { deleteObject, dbRun }), {
      action: 'store', image_data: base64(png), filename: 'db.png', description: 'DB failure',
    })).rejects.toThrow(/db unavailable/);

    expect(deleteObject).toHaveBeenCalledWith(put.mock.calls[0][0]);
  });

  it('returns stored-with-index-warning when vector indexing fails after DB commit', async () => {
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);
    const vectorUpsert = vi.fn(async () => { throw new Error('vector unavailable'); });

    const result = await handleMindStoreImage(testEnv(put, { deleteObject, vectorUpsert }), {
      action: 'store', image_data: base64(png), filename: 'vector.png', description: 'Vector failure',
    });

    expect(result).toMatch(/^Image stored \(#7\)/);
    expect(result).toMatch(/index warning/i);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('rejects spoofed bytes before writing R2', async () => {
    const put = vi.fn(async () => undefined);
    const result = await handleMindStoreImage(testEnv(put), {
      action: 'store',
      image_data: base64(new TextEncoder().encode('<html><script/></html>')),
      mime_type: 'image/png',
      description: 'Spoof',
    });

    expect(result).toMatch(/^Error: unsupported image bytes/i);
    expect(put).not.toHaveBeenCalled();
  });

  it('applies remote URL policy in the production store handler', async () => {
    const put = vi.fn(async () => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await handleMindStoreImage(testEnv(put), {
      action: 'store',
      source_url: 'https://169.254.169.254/latest/meta-data',
      description: 'Remote spoof',
    });

    expect(result).toMatch(/^Error: source_url fetch failed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

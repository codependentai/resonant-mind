import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/embeddings', () => ({
  getImageEmbedding: vi.fn(async () => [0.25]),
  getEmbedding: vi.fn(async () => [0.5]),
}));

import { getEmbedding, getImageEmbedding } from '../src/embeddings';
import { routeRequest } from '../src/http/router';
import { MAX_MULTIPART_IMAGE_BYTES } from '../src/shared/image-security';
import type { Env } from '../src/types';

const handlers = {} as Parameters<typeof routeRequest>[2];
const png = new Uint8Array(readFileSync(
  fileURLToPath(new URL('./fixtures/images/valid.png', import.meta.url)),
));

function uploadEnv(
  put: ReturnType<typeof vi.fn>,
  options: {
    deleteObject?: ReturnType<typeof vi.fn>;
    dbRun?: ReturnType<typeof vi.fn>;
    vectorUpsert?: ReturnType<typeof vi.fn>;
  } = {},
): Env {
  const dbRun = options.dbRun ?? vi.fn(async () => ({ meta: { last_row_id: 9 } }));
  return {
    MIND_API_KEY: 'test-api-key',
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
    GEMINI_API_KEY: 'test-gemini-key',
  } as unknown as Env;
}

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set('file', file);
  form.set('description', 'Direct upload');
  form.set('filename', 'claimed.jpg');
  return new Request('https://mind.example/api/images/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-api-key' },
    body: form,
  });
}

describe('direct image upload route', () => {
  beforeEach(() => {
    vi.mocked(getImageEmbedding).mockReset().mockResolvedValue([0.25]);
    vi.mocked(getEmbedding).mockReset().mockResolvedValue([0.5]);
  });

  it('validates bytes and stores canonical path and metadata', async () => {
    const put = vi.fn(async () => undefined);
    const response = await routeRequest(
      uploadRequest(new File([png], 'claimed.svg', { type: 'image/svg+xml' })),
      uploadEnv(put),
      handlers,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { path: string; format: string };
    expect(payload.path).toMatch(/_claimed_jpg_[0-9a-f-]{36}\.png$/);
    expect(payload.format).toBe('image/png');
    expect(put.mock.calls[0][2]).toEqual({ httpMetadata: { contentType: 'image/png' } });
  });

  it('gives same-name same-day uploads distinct keys without overwriting', async () => {
    const objects = new Map<string, Uint8Array>();
    const put = vi.fn(async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    });
    const env = uploadEnv(put);

    const first = await routeRequest(uploadRequest(new File([png], 'same.png')), env, handlers);
    const second = await routeRequest(uploadRequest(new File([png], 'same.png')), env, handlers);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstPath = (await first.json() as { path: string }).path;
    const secondPath = (await second.json() as { path: string }).path;
    expect(firstPath).not.toBe(secondPath);
    expect(objects.size).toBe(2);
  });

  it('deletes the new R2 object when the database insert fails', async () => {
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);
    const dbRun = vi.fn(async () => { throw new Error('db unavailable'); });

    const response = await routeRequest(
      uploadRequest(new File([png], 'db-failure.png')),
      uploadEnv(put, { deleteObject, dbRun }),
      handlers,
    );

    expect(response.status).toBe(500);
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(put.mock.calls[0][0]);
  });

  it('returns stored-with-index-warning when both embedding methods fail after DB commit', async () => {
    vi.mocked(getImageEmbedding).mockRejectedValue(new Error('multimodal unavailable'));
    vi.mocked(getEmbedding).mockRejectedValue(new Error('text unavailable'));
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);

    const response = await routeRequest(
      uploadRequest(new File([png], 'embedding-failure.png')),
      uploadEnv(put, { deleteObject }),
      handlers,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { id: number; embedded: boolean; embedding_note: string | null };
    expect(payload.id).toBe(9);
    expect(payload.embedded).toBe(false);
    expect(payload.embedding_note).toMatch(/stored.*index|index.*warning/i);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('returns stored-with-index-warning when vector indexing fails after DB commit', async () => {
    const put = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async () => undefined);
    const vectorUpsert = vi.fn(async () => { throw new Error('vector unavailable'); });

    const response = await routeRequest(
      uploadRequest(new File([png], 'vector-failure.png')),
      uploadEnv(put, { deleteObject, vectorUpsert }),
      handlers,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { id: number; embedded: boolean; embedding_note: string | null };
    expect(payload.id).toBe(9);
    expect(payload.embedded).toBe(false);
    expect(payload.embedding_note).toMatch(/stored.*index|index.*warning/i);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('rejects spoofed active bytes before writing R2', async () => {
    const put = vi.fn(async () => undefined);
    const response = await routeRequest(
      uploadRequest(new File(['<html><script/></html>'], 'spoof.png', { type: 'image/png' })),
      uploadEnv(put),
      handlers,
    );

    expect(response.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a declared multipart body that exceeds the finite envelope before parsing', async () => {
    const put = vi.fn(async () => undefined);
    const request = uploadRequest(new File([png], 'small.png', { type: 'image/png' }));
    request.headers.set('content-length', String(MAX_MULTIPART_IMAGE_BYTES + 1));

    const response = await routeRequest(request, uploadEnv(put), handlers);

    expect(response.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });
});

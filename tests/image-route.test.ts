import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/http/router';
import type { Env } from '../src/types';

const secret = 'image-signing-secret';
const handlers = {} as Parameters<typeof routeRequest>[2];

async function signedUrl(imageId: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${imageId}:${expires}`));
  const sig = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `https://mind.example/img/${imageId}?expires=${expires}&sig=${sig}`;
}

function servingEnv(path: string, metadataType: string): Env {
  return {
    SIGNING_SECRET: secret,
    MIND_API_KEY: 'api-key',
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ path }) }),
      }),
    },
    R2_IMAGES: {
      get: async () => ({
        body: new Blob(['image bytes']).stream(),
        httpMetadata: { contentType: metadataType },
      }),
    },
  } as unknown as Env;
}

describe('signed image route', () => {
  it('serves a canonical allowlisted type with nosniff instead of R2 metadata', async () => {
    const response = await routeRequest(
      new Request(await signedUrl('42')),
      servingEnv('r2://images/20260919_memory.png', 'text/html'),
      handlers,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('image bytes');
  });

  it('refuses legacy objects whose path has no safe image extension', async () => {
    const response = await routeRequest(
      new Request(await signedUrl('43')),
      servingEnv('r2://images/unsafe.svg', 'image/svg+xml'),
      handlers,
    );

    expect(response.status).toBe(415);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

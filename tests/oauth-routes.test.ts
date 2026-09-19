import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/http/router';
import type { Env } from '../src/types';

const handlers = {} as Parameters<typeof routeRequest>[2];
const env = {} as Env;

async function expectJsonNotFound(path: string, method = 'GET') {
  const response = await routeRequest(
    new Request(`https://mind.example${path}`, { method }),
    env,
    handlers,
  );

  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  await expect(response.json()).resolves.toEqual({ error: 'Not found' });
}

describe('unsupported OAuth routes', () => {
  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])('returns an explicit JSON 404 for discovery route %s', async (path) => {
    await expectJsonNotFound(path);
  });

  it.each(['/register', '/oauth/register'])('returns an explicit JSON 404 for registration route %s', async (path) => {
    await expectJsonNotFound(path, 'POST');
  });
});

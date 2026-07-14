import { describe, expect, it } from 'vitest';
import { isAuthorizedConnectorPath, isAuthorizedRequest, timingSafeEqual } from '../src/http/auth';
import type { Env } from '../src/types';

const env = {
  MIND_API_KEY: 'correct-horse-battery-staple',
  MCP_CONNECTOR_SECRET: 'separate-connector-secret',
} as Env;

describe('authentication primitives', () => {
  it('compares equal and unequal values safely', () => {
    expect(timingSafeEqual('same', 'same')).toBe(true);
    expect(timingSafeEqual('same', 'different')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('accepts only the configured bearer token', () => {
    expect(isAuthorizedRequest(new Request('https://mind.example/mcp', {
      headers: { Authorization: `Bearer ${env.MIND_API_KEY}` },
    }), env)).toBe(true);
    expect(isAuthorizedRequest(new Request('https://mind.example/mcp', {
      headers: { Authorization: 'Bearer wrong' },
    }), env)).toBe(false);
  });

  it('keeps connector-path compatibility exact and separate', () => {
    expect(isAuthorizedConnectorPath(new URL('https://mind.example/mcp/separate-connector-secret'), env)).toBe(true);
    expect(isAuthorizedConnectorPath(new URL('https://mind.example/mcp/correct-horse-battery-staple'), env)).toBe(false);
    expect(isAuthorizedConnectorPath(new URL('https://mind.example/mcp/separate-connector-secret/extra'), env)).toBe(false);
  });
});

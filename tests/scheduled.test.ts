import { describe, expect, it, vi } from 'vitest';
import { scheduleDaemon } from '../src/scheduled';

describe('scheduled daemon lifecycle', () => {
  it('logs daemon failures without converting the waitUntil promise to success', async () => {
    const failure = new Error('database unavailable');
    const log = vi.fn();
    let lifecycle: Promise<unknown> | undefined;
    const ctx = {
      waitUntil(promise: Promise<unknown>) { lifecycle = promise; },
    } as ExecutionContext;

    scheduleDaemon(ctx, async () => { throw failure; }, log);

    expect(lifecycle).toBeDefined();
    await expect(lifecycle).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith('daemon failed:', failure);
  });

  it('places synchronous setup failures on the waitUntil lifecycle', async () => {
    const failure = new Error('missing binding');
    let lifecycle: Promise<unknown> | undefined;
    const ctx = {
      waitUntil(promise: Promise<unknown>) { lifecycle = promise; },
    } as ExecutionContext;

    expect(() => scheduleDaemon(ctx, () => { throw failure; }, vi.fn())).not.toThrow();
    await expect(lifecycle).rejects.toBe(failure);
  });
});

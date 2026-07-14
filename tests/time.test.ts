import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTimeOfDayContext } from '../src/shared/time';

afterEach(() => vi.useRealTimers());

describe('deployment time context', () => {
  it('uses the configured timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'));
    expect(getTimeOfDayContext('UTC').period).toBe('midday');
    expect(getTimeOfDayContext('Pacific/Auckland').period).toBe('night');
  });

  it('falls back safely to UTC for an invalid timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T23:00:00Z'));
    expect(getTimeOfDayContext('not/a-zone').period).toBe('night');
  });
});

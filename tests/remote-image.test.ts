import { describe, expect, it, vi } from 'vitest';
import { fetchRemoteImage, validateRemoteImageUrl } from '../src/shared/image-security';

describe('Worker-safe remote image retrieval', () => {
  it.each([
    'http://public.example/image.png',
    'https://user:pass@public.example/image.png',
    'https://localhost/image.png',
    'https://service.local/image.png',
    'https://127.0.0.1/image.png',
    'https://10.0.0.8/image.png',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/image.png',
    'https://[::ffff:127.0.0.1]/image.png',
    'https://[::7f00:1]/image.png',
    'https://[::a00:1]/image.png',
    'https://[64:ff9b::7f00:1]/image.png',
    'https://[64:ff9b::a00:1]/image.png',
    'https://[::ffff:0:7f00:1]/image.png',
    'https://[100::1]/image.png',
  ])('rejects unsafe source URL %s', (url) => {
    expect(() => validateRemoteImageUrl(url)).toThrow(/source_url/i);
  });

  it('allows a syntactically valid global IPv6 literal', () => {
    expect(validateRemoteImageUrl('https://[2606:4700:4700::1111]/image.png').hostname)
      .toBe('[2606:4700:4700::1111]');
  });

  it('cancels a redirect body before fetching the next hop', async () => {
    const events: string[] = [];
    const redirectBody = new ReadableStream<Uint8Array>({
      cancel() { events.push('cancel redirect'); },
    });
    const fetchStub = vi.fn(async () => {
      events.push(`fetch ${fetchStub.mock.calls.length}`);
      if (fetchStub.mock.calls.length === 1) {
        return new Response(redirectBody, {
          status: 302,
          headers: { location: 'https://public.example/final.png' },
        });
      }
      return new Response(Uint8Array.of(1));
    });

    await expect(fetchRemoteImage('https://public.example/image.png', { fetchImpl: fetchStub }))
      .resolves.toEqual(Uint8Array.of(1));
    expect(events).toEqual(['fetch 1', 'cancel redirect', 'fetch 2']);
  });

  it('cancels a non-success response body before throwing', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const fetchStub = vi.fn(async () => new Response(body, { status: 503 }));

    await expect(fetchRemoteImage('https://public.example/image.png', { fetchImpl: fetchStub }))
      .rejects.toThrow(/503/);
    expect(cancelled).toBe(true);
  });

  it('cancels a declared-oversize response body before throwing', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const fetchStub = vi.fn(async () => new Response(body, {
      headers: { 'content-length': '6' },
    }));

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      maxBytes: 5,
    })).rejects.toThrow(/too large/i);
    expect(cancelled).toBe(true);
  });

  it('validates every redirect before fetching the next hop', async () => {
    const fetchStub = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/private.png' },
    }));

    await expect(fetchRemoteImage('https://public.example/image.png', { fetchImpl: fetchStub }))
      .rejects.toThrow(/source_url/i);
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(fetchStub.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('caps manual redirects', async () => {
    const fetchStub = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://public.example/next.png' },
    }));

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      maxRedirects: 2,
    })).rejects.toThrow(/too many redirects/i);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('rejects a declared response larger than the byte ceiling', async () => {
    const fetchStub = vi.fn(async () => new Response('tiny', {
      headers: { 'content-length': '6' },
    }));

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      maxBytes: 5,
    })).rejects.toThrow(/too large/i);
  });

  it('cancels streamed responses that cross the byte ceiling', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3));
        controller.enqueue(Uint8Array.of(4, 5, 6));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchStub = vi.fn(async () => new Response(body));

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      maxBytes: 5,
    })).rejects.toThrow(/too large/i);
    expect(cancelled).toBe(true);
  });

  it('enforces one absolute timeout through AbortController', async () => {
    const fetchStub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      timeoutMs: 5,
    })).rejects.toThrow(/timed out/i);
  });

  it('keeps the absolute timeout active while streaming the body', async () => {
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(body);
    });

    await expect(fetchRemoteImage('https://public.example/image.png', {
      fetchImpl: fetchStub,
      timeoutMs: 5,
    })).rejects.toThrow(/timed out/i);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { constructedWith, embedContent } = vi.hoisted(() => ({
  constructedWith: [] as string[],
  embedContent: vi.fn(async () => ({ embeddings: [{ values: [3, 4] }] })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent, generateContent: vi.fn() };

    constructor({ apiKey }: { apiKey: string }) {
      constructedWith.push(apiKey);
    }
  },
}));

describe('Gemini client lifecycle', () => {
  beforeEach(() => {
    constructedWith.length = 0;
    embedContent.mockClear();
    vi.resetModules();
  });

  it('reuses a client for one key and creates a new client after key rotation', async () => {
    const { getEmbedding } = await import('../src/embeddings');

    await getEmbedding('first-key', 'one');
    await getEmbedding('first-key', 'two');
    await getEmbedding('rotated-key', 'three');

    expect(constructedWith).toEqual(['first-key', 'rotated-key']);
    expect(embedContent).toHaveBeenCalledTimes(3);
  });
});

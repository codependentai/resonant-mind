/**
 * Gemini Embedding 2 Provider
 *
 * Replaces Workers AI (@cf/baai/bge-base-en-v1.5) with Gemini Embedding 2.
 * 768 dimensions, L2 normalized, multimodal (text + images).
 */

import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-embedding-2-preview";
const GENERATION_MODEL = "gemini-2.5-flash-lite";
const DIMENSIONS = 768;
const EMBEDDING_TIMEOUT_MS = 10000;
const GENERATION_TIMEOUT_MS = 20000;

let client: GoogleGenAI | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * L2 normalize a vector. Required for Gemini at 768d (not pre-normalized).
 */
function l2Normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return magnitude > 0 ? vec.map((v) => v / magnitude) : vec;
}

/**
 * Generate text via Gemini Flash — used for memory consolidation and reflection.
 */
export async function generateText(
  apiKey: string,
  prompt: string
): Promise<string> {
  const ai = getClient(apiKey);
  const response = await withTimeout(
    ai.models.generateContent({
      model: GENERATION_MODEL,
      contents: prompt,
    }),
    GENERATION_TIMEOUT_MS,
    "Gemini generateText"
  );
  return response.text || "";
}

/**
 * Generate a text embedding via Gemini Embedding 2.
 * Drop-in replacement for the old getEmbedding(env.AI, text).
 */
export async function getEmbedding(
  apiKey: string,
  text: string
): Promise<number[]> {
  const ai = getClient(apiKey);
  const response = await withTimeout(
    ai.models.embedContent({
      model: MODEL,
      contents: text,
      config: { outputDimensionality: DIMENSIONS },
    }),
    EMBEDDING_TIMEOUT_MS,
    "Gemini getEmbedding"
  );
  return l2Normalize(response.embeddings![0].values!);
}

/**
 * Generate a multimodal embedding via Gemini Embedding 2.
 * Combines image + contextual text for richer semantic meaning.
 * "the mind feels pride looking at this — a trusted person's first article" + the actual image.
 */
export async function getImageEmbedding(
  apiKey: string,
  imageData: ArrayBuffer,
  mimeType: string,
  contextText?: string
): Promise<number[]> {
  const ai = getClient(apiKey);
  // Chunk-based base64 encoding (spread operator blows stack on large arrays)
  const bytes = new Uint8Array(imageData);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  // Embed text + image together for richer semantic meaning
  // Fall back to text-only if multimodal fails
  const contextFallback = contextText || `[image: ${mimeType}]`;
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (contextText) {
    parts.push({ text: contextText });
  }
  parts.push({ inlineData: { data: base64, mimeType } });

  const response = await withTimeout(
    ai.models.embedContent({
      model: MODEL,
      contents: [{ role: "user", parts }] as any,
      config: { outputDimensionality: DIMENSIONS },
    }),
    EMBEDDING_TIMEOUT_MS,
    "Gemini getImageEmbedding"
  );
  return l2Normalize(response.embeddings![0].values!);
}

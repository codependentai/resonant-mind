/**
 * Cross-cutting helpers used by many MCP tool handlers:
 *  - `getEmbedding` — local wrapper around the Gemini embed call
 *  - `searchVectors` — embed a query then hit the Vectorize index
 *  - `imageUrl` — generate a signed (HMAC-SHA256) URL for serving an R2 image
 */

import type { Env } from "../types";
import { getEmbedding as getGeminiEmbedding } from "../embeddings";

export async function getEmbedding(env: Env, text: string): Promise<number[]> {
  return getGeminiEmbedding(env.GEMINI_API_KEY, text);
}

export async function searchVectors(env: Env, query: string, topK: number) {
  const embedding = await getEmbedding(env, query);
  return env.VECTORS.query(embedding, { topK, returnMetadata: "all" });
}

/**
 * Generate a signed R2 image URL with 1-hour expiry. The API key is never
 * exposed in the URL — the signature proves authorisation without leaking
 * the secret.
 */
export async function imageUrl(imageId: number | string, env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SIGNING_SECRET || env.MIND_API_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${imageId}:${expires}`));
  const sig = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!env.WORKER_URL) throw new Error("WORKER_URL is required for signed image URLs");
  return `${env.WORKER_URL.replace(/\/$/, "")}/img/${imageId}?expires=${expires}&sig=${sig}`;
}

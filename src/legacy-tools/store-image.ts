/**
 * handleMindStoreImage — store/view/search/delete images with R2 + multimodal embedding.
 * Converts uploaded images to WebP via Cloudflare Image Resizing.
 */

import type { Env } from "../types";
import { getEmbedding, imageUrl } from "../shared/mind-helpers";
import { getImageEmbedding } from "../embeddings";
import { normalizeText } from "../shared/text";
import { R2_IMAGE_PATH_PREFIX } from "../shared/constants";

export async function handleMindStoreImage(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  // === STORE: (image_data OR source_url) → R2 (with WebP) → multimodal embed → D1.
  // Atomic: if R2 or embedding fails, no D1 row. No "pending" state possible.
  if (action === "store") {
    const imageData = params.image_data as string | undefined;
    const sourceUrl = params.source_url as string | undefined;
    let mimeType = (params.mime_type as string) || "image/png";
    const filename = params.filename as string;
    const description = params.description as string;
    const entityName = params.entity_name as string;
    const emotion = params.emotion as string;
    const weight = (params.weight as string) || "medium";
    const context = params.context as string;
    const observationId = params.observation_id as number;

    if (!imageData && !sourceUrl) return "Error: either image_data (base64) or source_url (URL the worker can fetch) is required.";
    if (!description) return "Error: description is required.";
    if (!env.R2_IMAGES) return "Error: R2 binding unavailable.";

    // Resolve entity
    let entityId: number | null = null;
    if (entityName) {
      const entity = await env.DB.prepare("SELECT id FROM entities WHERE name = ?").bind(entityName).first();
      if (entity) entityId = entity.id as number;
    }

    // --- Acquire raw bytes: either decode base64 or fetch the source URL. ---
    let rawBinary: Uint8Array;
    if (sourceUrl) {
      if (!/^https:\/\//i.test(sourceUrl)) {
        return "Error: source_url must be https://";
      }
      try {
        const fetchResp = await fetch(sourceUrl, {
          headers: { "User-Agent": "resonant-mind/store-image" },
          signal: AbortSignal.timeout(15000),
        });
        if (!fetchResp.ok) {
          return `Error: source_url fetch returned ${fetchResp.status} ${fetchResp.statusText}`;
        }
        const contentLength = parseInt(fetchResp.headers.get("content-length") || "0", 10);
        if (contentLength > 10 * 1024 * 1024) {
          return `Error: source_url file too large (${Math.round(contentLength / 1024 / 1024)}MB, max 10MB)`;
        }
        const fetchedType = fetchResp.headers.get("content-type")?.split(";")[0].trim();
        if (fetchedType && fetchedType.startsWith("image/")) {
          mimeType = fetchedType;
        }
        const arrayBuf = await fetchResp.arrayBuffer();
        if (arrayBuf.byteLength > 10 * 1024 * 1024) {
          return `Error: source_url file too large after fetch (${Math.round(arrayBuf.byteLength / 1024 / 1024)}MB, max 10MB)`;
        }
        rawBinary = new Uint8Array(arrayBuf);
      } catch (e) {
        return `Error: source_url fetch failed — ${String(e).slice(0, 120)}`;
      }
    } else {
      try {
        rawBinary = Uint8Array.from(atob(imageData!), c => c.charCodeAt(0));
      } catch (e) {
        return `Error: base64 decode failed — image_data is not valid base64 (${String(e).slice(0, 100)})`;
      }
    }

    // --- R2 upload (with WebP conversion). Throws on failure → no D1 insert. ---
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safeName = (filename || description.slice(0, 50))
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 60);
    const ext = mimeType === "image/jpeg" ? ".jpg"
      : mimeType === "image/webp" ? ".webp"
      : mimeType === "image/gif" ? ".gif"
      : ".png";
    const storedKey = `${date}_${safeName}${ext}`;
    await env.R2_IMAGES.put(storedKey, rawBinary, { httpMetadata: { contentType: mimeType } });

    const storedPath = `${R2_IMAGE_PATH_PREFIX}${storedKey}`;
    const storedMime = mimeType;

    // --- Multimodal embedding. Gemini accepts PNG, JPEG, WebP, HEIC, HEIF. ---
    const contextText = [
      entityName ? `${entityName}:` : "", description,
      context ? `(${context})` : "", emotion ? `[${emotion}]` : ""
    ].filter(Boolean).join(" ");

    let embedding: number[];
    let embeddingNote: string | null = null;
    try {
      embedding = await getImageEmbedding(env.GEMINI_API_KEY, rawBinary.buffer as ArrayBuffer, mimeType, contextText);
    } catch (e) {
      // Multimodal failed — fall back to text embedding rather than block the store.
      embedding = await getEmbedding(env, contextText);
      embeddingNote = `multimodal failed (${String(e).slice(0, 80)}), used text fallback`;
    }

    // --- D1 insert only after R2 succeeded. ---
    const result = await env.DB.prepare(`
      INSERT INTO images (path, description, context, emotion, weight, entity_id, observation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(storedPath, description, context || null, normalizeText(emotion), weight, entityId, observationId || null).run();

    const imageId = result.meta.last_row_id;

    // --- Vectorize upsert. ---
    const imgMetadata: Record<string, string> = {
      source: "image", description, weight, added_at: new Date().toISOString(), path: storedPath
    };
    if (entityName) imgMetadata.entity = entityName;
    if (context) imgMetadata.context = context;
    if (emotion) imgMetadata.emotion = normalizeText(emotion) || emotion;
    await env.VECTORS.upsert([{ id: `img-${imageId}`, values: embedding, metadata: imgMetadata }]);

    let response = `Image stored (#${imageId}) [R2: ${storedMime}, ${embeddingNote ? "text-fallback" : "multimodal"} embedded]`;
    if (embeddingNote) response += `\n${embeddingNote}`;
    if (entityName) response += `\nEntity: ${entityName}`;
    if (emotion) response += ` | Emotion: ${emotion}`;
    response += `\nPath: ${storedPath}`;
    return response;
  }

  // === VIEW: Browse images by filter ===
  // collision-audit.md E-3: "view" reads as a browse/query action but has a
  // real hidden write below — every returned image gets last_viewed_at/
  // view_count bumped. Same class as mind_search/graph_look's (né
  // mind_read_entity) access-tracking; flagged so this doesn't get mistaken
  // for a pure read.
  if (action === "view") {
    const entityName = params.entity_name as string;
    const emotion = params.emotion as string;
    const weight = params.weight as string;
    const random = params.random as boolean;
    const limit = (params.limit as number) || 5;

    let query = `SELECT i.*, e.name as entity_name, e.entity_type FROM images i LEFT JOIN entities e ON i.entity_id = e.id WHERE 1=1`;
    const bindings: unknown[] = [];

    if (entityName) { query += ` AND e.name = ?`; bindings.push(entityName); }
    if (emotion) { query += ` AND i.emotion = ?`; bindings.push(emotion); }
    if (weight) { query += ` AND i.weight = ?`; bindings.push(weight); }
    query += random ? ` ORDER BY RANDOM()` : ` ORDER BY i.created_at DESC`;
    query += ` LIMIT ?`;
    bindings.push(limit);

    const images = await env.DB.prepare(query).bind(...bindings).all();
    if (!images.results?.length) {
      return `No visual memories found. Use mind_store_image(action="store") to add some.`;
    }

    for (const id of images.results.map((i: any) => i.id)) {
      await env.DB.prepare(`UPDATE images SET last_viewed_at = datetime('now'), view_count = view_count + 1 WHERE id = ?`).bind(id).run();
    }

    let output = `## Visual Memories\n\n`;
    if (random) output += `*Random selection*\n\n`;
    for (const img of images.results as any[]) {
      const emotionTag = img.emotion ? ` [${img.emotion}]` : "";
      const entityTag = img.entity_name ? ` -> ${img.entity_name}` : "";
      output += `**#${img.id}** [${img.weight}]${emotionTag}${entityTag}\n`;
      output += `${img.description}\n`;
      if (img.context) output += `*${img.context}*\n`;
      if (img.path?.startsWith("r2://")) {
        output += `View: ${await imageUrl(img.id, env)}\n`;
      } else if (img.path && img.path !== "pending") {
        output += `Path: \`${img.path}\`\n`;
      }
      output += `\n`;
    }
    return output;
  }

  // === SEARCH: Semantic image search via pgvector ===
  if (action === "search") {
    const query = params.query as string;
    const limit = (params.limit as number) || 5;
    if (!query) return "Error: query is required for image search.";

    const embedding = await getEmbedding(env, query);
    const results = await env.VECTORS.query(embedding, { topK: limit * 3, returnMetadata: "all" });

    const imageMatches = results.matches?.filter((m: any) => m.id.startsWith("img-")) || [];
    if (!imageMatches.length) return "No images match that query.";

    let output = `## Image Search: "${query}"\n\n`;
    for (const match of imageMatches.slice(0, limit)) {
      const meta = match.metadata as Record<string, string>;
      const score = Math.round(match.score * 100);
      output += `**${match.id}** (${score}%)`;
      if (meta?.entity) output += ` -> ${meta.entity}`;
      if (meta?.emotion) output += ` [${meta.emotion}]`;
      const imgId = match.id.replace("img-", "");
      output += `\n${meta?.description || "No description"}\n`;
      output += `View: ${await imageUrl(imgId, env)}\n`;
      output += `\n`;
    }
    return output;
  }

  // === DELETE: Remove DB row + Vectorize entry + R2 object (only if unreferenced). ===
  if (action === "delete") {
    const imgId = params.image_id as number;
    if (!imgId) return "Error: image_id required for delete.";
    const img = await env.DB.prepare(`SELECT path, description FROM images WHERE id = ?`).bind(imgId).first();
    if (!img) return `Image #${imgId} not found.`;
    await env.DB.prepare(`DELETE FROM images WHERE id = ?`).bind(imgId).run();
    try { await env.VECTORS.deleteByIds([`img-${imgId}`]); } catch {}
    let r2Note = "R2 not stored";
    if (img.path && String(img.path).startsWith(R2_IMAGE_PATH_PREFIX)) {
      const r2Key = String(img.path).slice(R2_IMAGE_PATH_PREFIX.length);
      // Only delete R2 if no other row still references this path (avoids cascading on duplicates).
      const stillUsed = await env.DB.prepare(`SELECT 1 FROM images WHERE path = ? LIMIT 1`).bind(img.path).first();
      if (stillUsed) {
        r2Note = "R2 retained (still referenced by another row)";
      } else {
        try { await env.R2_IMAGES.delete(r2Key); r2Note = "R2 cleaned"; } catch { r2Note = "R2 delete failed"; }
      }
    }
    return `Deleted image #${imgId}: "${String(img.description).slice(0, 50)}..." [DB + Vectorize cleaned, ${r2Note}]`;
  }

  return "Unknown action. Use: store, view, search, or delete.";
}

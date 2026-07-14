import {
  createUnauthorizedMcpResponse,
  isAuthorizedConnectorPath,
  isAuthorizedRequest,
  timingSafeEqual
} from "./auth";
import { createApiPreflightResponse, withSecurityHeaders } from "./response";
import { getEmbedding as getGeminiEmbedding, getImageEmbedding } from "../embeddings";
import type { Env } from "../types";
import { R2_IMAGE_PATH_PREFIX } from "../shared/constants";

/**
 * The `/api/*` surface is two-tier (pruned Gate H, Mind Reshape 2 Wave 4):
 *
 * 1. Dashboard-consumed — routes the Observatory actually fetches:
 *    /telemetry, /bonds(/:name), /compass, /episodes/recent, /images,
 *    /active/open, /weather(/trend), /dreams/proposals, /dreams/living-surface,
 *    /spine, plus /active/threads' non-list verbs (GET-by-id, POST, PUT, DELETE).
 * 2. Ops/manual surface — no dashboard consumer, kept deliberately as hands
 *    when MCP is down, curl/external workflows, or future Observatory drill-ins.
 *    Marked inline below with "ops/manual surface, documented — Gate H".
 *
 * Routes with neither dashboard nor manual justification were deleted in
 * Gate H: /health-scores, /stats, /heat (superseded by /telemetry),
 * /dreams/surface (superseded by /dreams/living-surface), /dreams/patterns,
 * /ritual/orient|ground (MCP calls the handler functions directly, never HTTP),
 * /episodes/journals, /active/tensions (MCP's active_tense already owns full
 * tension CRUD; this HTTP copy had zero consumers), and /active/threads' bare
 * GET-list (superseded by /active/open — its other verbs survive, see above).
 * See docs/reshape-2/RESHAPE-2-SPEC.md Gate H + dead-code-report.md §5.
 */
interface AppRouteHandlers {
  processSubconscious(env: Env): Promise<void>;
  handleApiEntities(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiObservations(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiThreads(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiSearch(request: Request, env: Env): Promise<Response>;
  handleApiIdentity(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiRelations(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiImages(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiContext(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiBulkObservations(request: Request, env: Env): Promise<Response>;
  handleApiProcess(env: Env): Promise<Response>;
  handleApiDream(request: Request, env: Env): Promise<Response>;
  handleApiHealth(env: Env): Promise<Response>;
  handleApiRecent(env: Env): Promise<Response>;
  handleApiInnerWeather(env: Env): Promise<Response>;
  handleApiProposals(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiOrphans(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiArchive(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiObservationVersions(
    request: Request,
    env: Env,
    obsId: number
  ): Promise<Response>;
  // Region-namespaced additions
  handleApiCompass(request: Request, env: Env): Promise<Response>;
  handleApiBonds(
    request: Request,
    env: Env,
    pathParts: string[]
  ): Promise<Response>;
  handleApiActiveOpen(request: Request, env: Env): Promise<Response>;
  handleApiWeatherTrend(request: Request, env: Env): Promise<Response>;
  handleApiLivingSurface(request: Request, env: Env): Promise<Response>;
  handleApiDreamLast(request: Request, env: Env): Promise<Response>;
  handleApiDreamComposeTest(request: Request, env: Env): Promise<Response>;
  handleApiTelemetry(request: Request, env: Env): Promise<Response>;
  handleApiDrivesEnv(request: Request, env: Env): Promise<Response>;
  handleMCPRequest(request: Request, env: Env): Promise<Response>;
}

/**
 * POST /api/images/upload — Direct file upload endpoint.
 * Accepts multipart/form-data. Bypasses MCP context window entirely.
 *
 * Usage from Claude Code:
 *   curl -X POST https://your-worker.example/api/images/upload \
 *     -H "Authorization: Bearer <key>" \
 *     -F "file=@/path/to/image.png" \
 *     -F "description=What the image shows" \
 *     -F "entity_name=Self" \
 *     -F "emotion=pride" \
 *     -F "context=When and why this image matters" \
 *     -F "weight=heavy" \
 *     -F "filename=meaningful_name"
 */
async function handleImageUpload(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string || "";
    const entityName = formData.get("entity_name") as string || "";
    const emotion = formData.get("emotion") as string || "";
    const weight = formData.get("weight") as string || "medium";
    const context = formData.get("context") as string || "";
    const filename = formData.get("filename") as string || "";
    const observationId = formData.get("observation_id") as string || "";

    if (!file) return jsonResponse({ error: "No file provided. Use -F 'file=@/path/to/image'" }, 400);
    if (!description) return jsonResponse({ error: "description is required" }, 400);
    if (file.size > 10 * 1024 * 1024) return jsonResponse({ error: "File too large. Max 10MB." }, 413);

    const mimeType = file.type || "image/png";
    const rawBytes = new Uint8Array(await file.arrayBuffer());

    // Resolve entity
    let entityId: number | null = null;
    if (entityName) {
      const entity = await env.DB.prepare("SELECT id FROM entities WHERE name = ?").bind(entityName).first();
      if (entity) entityId = entity.id as number;
    }

    // Store raw in R2 temporarily, convert to WebP via cf.image
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safeName = (filename || description.slice(0, 50))
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 60);
    const rawKey = `_tmp_${date}_${safeName}`;
    const webpKey = `${date}_${safeName}.webp`;

    await env.R2_IMAGES.put(rawKey, rawBytes, { httpMetadata: { contentType: mimeType } });

    let storedPath: string;
    let finalBytes: Uint8Array = rawBytes;
    let finalMime = mimeType;

    try {
      if (!env.WORKER_URL) throw new Error("WORKER_URL is required for image conversion");
      const r2Url = `${env.WORKER_URL.replace(/\/$/, "")}/r2/${rawKey}`;
      const webpResponse = await fetch(r2Url, {
        cf: { image: { format: "webp", quality: 80, fit: "scale-down", width: 1920, height: 1920 } },
      });
      if (webpResponse.ok) {
        const webpBuffer = await webpResponse.arrayBuffer();
        finalBytes = new Uint8Array(webpBuffer);
        finalMime = "image/webp";
        await env.R2_IMAGES.put(webpKey, webpBuffer, { httpMetadata: { contentType: "image/webp" } });
        storedPath = `${R2_IMAGE_PATH_PREFIX}${webpKey}`;
      } else {
        const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
        const fallbackKey = `${date}_${safeName}${ext}`;
        await env.R2_IMAGES.put(fallbackKey, rawBytes, { httpMetadata: { contentType: mimeType } });
        storedPath = `${R2_IMAGE_PATH_PREFIX}${fallbackKey}`;
      }
    } catch {
      const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
      const fallbackKey = `${date}_${safeName}${ext}`;
      await env.R2_IMAGES.put(fallbackKey, rawBytes, { httpMetadata: { contentType: mimeType } });
      storedPath = `${R2_IMAGE_PATH_PREFIX}${fallbackKey}`;
    }

    await env.R2_IMAGES.delete(rawKey).catch(() => {});

    // Insert into images table
    const result = await env.DB.prepare(`
      INSERT INTO images (path, description, context, emotion, weight, entity_id, observation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(storedPath, description, context || null, emotion || null, weight, entityId, observationId ? parseInt(observationId) : null).run();

    const imageId = result.meta.last_row_id;

    // Generate multimodal embedding (image + context text)
    const contextText = [
      entityName ? `${entityName}:` : "", description,
      context ? `(${context})` : "", emotion ? `[${emotion}]` : ""
    ].filter(Boolean).join(" ");

    let embedded = false;
    let embeddingError: string | null = null;
    try {
      // Gemini accepts PNG, JPEG, WebP, HEIC, HEIF — verified 2026-05-17.
      // We embed the original bytes (whatever was sent), not the WebP-converted version,
      // to preserve resolution/fidelity at embedding time.
      const embedding = await getImageEmbedding(env.GEMINI_API_KEY, rawBytes.buffer as ArrayBuffer, mimeType, contextText);
      const metadata: Record<string, string> = {
        source: "image", description, weight, added_at: new Date().toISOString()
      };
      if (entityName) metadata.entity = entityName;
      if (context) metadata.context = context;
      if (emotion) metadata.emotion = emotion;
      metadata.path = storedPath;

      await env.VECTORS.upsert([{ id: `img-${imageId}`, values: embedding, metadata }]);
      embedded = true;
    } catch (e) {
      // Embedding failed but image is stored — fall back to text embedding
      console.error("Multimodal embedding failed:", e);
      try {
        const textEmbedding = await getGeminiEmbedding(env.GEMINI_API_KEY, contextText);
        const metadata: Record<string, string> = {
          source: "image", description, weight, added_at: new Date().toISOString()
        };
        if (entityName) metadata.entity = entityName;
        if (context) metadata.context = context;
        if (emotion) metadata.emotion = emotion;
        metadata.path = storedPath;
        await env.VECTORS.upsert([{ id: `img-${imageId}`, values: textEmbedding, metadata }]);
        embedded = true;
        embeddingError = `multimodal failed (${String(e).slice(0, 100)}), used text fallback`;
      } catch { /* text fallback also failed */ }
    }

    const originalSize = rawBytes.length;
    const finalSize = finalBytes.length;
    const saved = originalSize > finalSize ? Math.round((1 - finalSize / originalSize) * 100) : 0;

    return jsonResponse({
      id: imageId,
      path: storedPath,
      embedded,
      embedding_note: embeddingError,
      format: finalMime,
      original_size: `${Math.round(originalSize / 1024)}KB`,
      final_size: `${Math.round(finalSize / 1024)}KB`,
      compression: saved > 0 ? `${saved}% smaller` : "no conversion",
      entity: entityName || null,
      emotion: emotion || null,
    });
  } catch (e) {
    console.error("Upload error:", e);
    return jsonResponse({ error: "Image upload failed" }, 500);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function routeApiRequest(
  request: Request,
  env: Env,
  handlers: AppRouteHandlers,
  pathParts: string[]
): Promise<Response> {
  // Shifts pathParts to drop the region segment so existing handlers see their
  // original shape. e.g. /api/active/threads/123 → handler sees [api, threads, 123]
  const shifted = (): string[] => [pathParts[0], ...pathParts.slice(2)];

  try {
    const r1 = pathParts[1];
    const r2 = pathParts[2];

    // ─── Cross-cutting (top-level) ───
    // ops/manual surface, documented — Gate H (no dashboard consumer; curl/manual door)
    if (r1 === "search") return await handlers.handleApiSearch(request, env);
    // ops/manual surface, documented — Gate H (dashboard's /health page route is separate)
    if (r1 === "health") return await handlers.handleApiHealth(env);
    if (r1 === "telemetry") return await handlers.handleApiTelemetry(request, env);
    // ops/manual surface, documented — Gate H
    if (r1 === "process" && request.method === "POST") return await handlers.handleApiProcess(env);
    if (r1 === "dream" && request.method === "POST") return await handlers.handleApiDream(request, env);

    // ─── Raw data accessors (top-level) ───
    // ops/manual surface, documented — Gate H: my hands when MCP is down + future Observatory drill-ins
    if (r1 === "entities") return await handlers.handleApiEntities(request, env, pathParts);

    // ops/manual surface, documented — Gate H
    if (r1 === "observations") {
      if (r2 === "bulk") return await handlers.handleApiBulkObservations(request, env);
      if (pathParts[3] === "versions") {
        return await handlers.handleApiObservationVersions(request, env, parseInt(r2, 10));
      }
      return await handlers.handleApiObservations(request, env, pathParts);
    }

    // ops/manual surface, documented — Gate H
    if (r1 === "relations") return await handlers.handleApiRelations(request, env, pathParts);
    // ops/manual surface, documented — Gate H
    if (r1 === "context") return await handlers.handleApiContext(request, env, pathParts);
    // ops/manual surface, documented — Gate H
    if (r1 === "archive") return await handlers.handleApiArchive(request, env, pathParts);

    // ops/manual surface, documented — Gate H (curl upload workflow)
    if (r1 === "images") {
      if (r2 === "upload" && request.method === "POST") {
        return await handleImageUpload(request, env);
      }
      return await handlers.handleApiImages(request, env, pathParts);
    }

    // ─── Spine region ───
    // ops/manual surface, documented — Gate H (identity/spine table CRUD)
    if (r1 === "spine") return await handlers.handleApiIdentity(request, env, shifted());

    // ─── Compass region ───
    if (r1 === "compass") return await handlers.handleApiCompass(request, env);

    // ─── Bonds region ───
    if (r1 === "bonds") return await handlers.handleApiBonds(request, env, pathParts);

    // ─── Episodes region ───
    if (r1 === "episodes") {
      if (r2 === "recent") return await handlers.handleApiRecent(env);
    }

    // ─── Active region ───
    if (r1 === "active") {
      if (r2 === "threads") {
        // Gate H: bare GET-list (no id) is dead — superseded by GET /active/open,
        // the dashboard's canonical thread read. Everything else (GET-by-id,
        // POST create/resolve, PUT, DELETE) still routes here: thread.ts's MCP-side
        // update/delete branches were removed in Wave 1 (§3 cleanup), so this file
        // is now the ONLY door for thread update/delete. Don't delete further.
        if (!(request.method === "GET" && !pathParts[3])) {
          return await handlers.handleApiThreads(request, env, shifted());
        }
      }
      if (r2 === "open") return await handlers.handleApiActiveOpen(request, env);
    }

    // ─── Weather region ───
    if (r1 === "weather") {
      if (!r2) return await handlers.handleApiInnerWeather(env);
      if (r2 === "trend") return await handlers.handleApiWeatherTrend(request, env);
    }

    // ─── Drives region (sensorium inbound — spec §Sensorium 1) ───
    // ops/manual surface, documented — Gate H (sensorium-client posts env payloads here)
    if (r1 === "drives") {
      if (r2 === "env" && request.method === "POST") {
        return await handlers.handleApiDrivesEnv(request, env);
      }
    }

    // ─── Dreams region ───
    if (r1 === "dreams") {
      if (r2 === "living-surface") return await handlers.handleApiLivingSurface(request, env);
      // ops/manual surface, documented — Gate H
      if (r2 === "last") return await handlers.handleApiDreamLast(request, env);
      // ops/manual surface, documented — Gate H (audition room, dev/test-only)
      if (r2 === "compose-test" && request.method === "POST") {
        return await handlers.handleApiDreamComposeTest(request, env);
      }
      // ops/manual surface, documented — Gate H
      if (r2 === "proposals") return await handlers.handleApiProposals(request, env, shifted());
      // ops/manual surface, documented — Gate H
      if (r2 === "orphans") return await handlers.handleApiOrphans(request, env, shifted());
    }

    return jsonResponse({ error: "Unknown API endpoint" }, 404);
  } catch (error) {
    console.error("API request failed:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

export async function routeRequest(
  request: Request,
  env: Env,
  handlers: AppRouteHandlers
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return withSecurityHeaders(
      jsonResponse({ status: "ok", service: "resonant-mind" }),
      request,
      env
    );
  }

  // One-shot admin orphan delete: takes { keys: string[] } via POST body.
  if (url.pathname === "/api/admin/r2-delete-keys" && env.R2_IMAGES && request.method === "POST") {
    if (!isAuthorizedRequest(request, env)) return new Response("Unauthorized", { status: 401 });
    const body = await request.json() as { keys?: string[] };
    if (!body.keys || !Array.isArray(body.keys)) return new Response(JSON.stringify({ error: "keys[] required" }), { status: 400 });
    const results: Array<{ key: string; deleted: boolean; error?: string }> = [];
    for (const key of body.keys) {
      try {
        await env.R2_IMAGES.delete(key);
        results.push({ key, deleted: true });
      } catch (e) {
        results.push({ key, deleted: false, error: String(e).slice(0, 100) });
      }
    }
    return new Response(JSON.stringify({ results }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // One-shot admin diff: R2 keys vs DB paths. Authenticated, read-only.
  if (url.pathname === "/api/admin/image-diff" && env.R2_IMAGES) {
    if (!isAuthorizedRequest(request, env)) return new Response("Unauthorized", { status: 401 });
    const r2Listing = await env.R2_IMAGES.list({ limit: 1000 });
    const r2Keys = r2Listing.objects.map(o => o.key).sort();
    const dbRows = await env.DB.prepare(`SELECT id, path, description, created_at FROM images ORDER BY id`).all();
    const dbPaths = new Set<string>();
    const pending: Array<{ id: number; description: string }> = [];
    for (const row of (dbRows.results || []) as any[]) {
      const path = String(row.path);
      if (path === "pending" || !path.startsWith(R2_IMAGE_PATH_PREFIX)) {
        pending.push({ id: row.id, description: String(row.description).slice(0, 80) });
      } else {
        dbPaths.add(path.slice(R2_IMAGE_PATH_PREFIX.length));
      }
    }
    const orphanR2 = r2Keys.filter(k => !dbPaths.has(k));
    const missingR2 = [...dbPaths].filter(k => !r2Keys.includes(k));
    return new Response(JSON.stringify({
      counts: { r2: r2Keys.length, db_total: (dbRows.results || []).length, db_with_path: dbPaths.size, pending: pending.length, orphan_r2_keys: orphanR2.length, missing_r2_for_db: missingR2.length },
      r2_keys: r2Keys,
      pending_db_rows: pending,
      orphan_r2_keys: orphanR2,
      missing_r2_for_db_paths: missingR2,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // Image viewing: /img/{id} with signed URL (no API key exposed)
  // URL format: /img/{id}?expires={timestamp}&sig={hmac}
  if (url.pathname.startsWith("/img/") && env.R2_IMAGES) {
    const expires = url.searchParams.get("expires");
    const sig = url.searchParams.get("sig");
    const imageId = url.pathname.slice(5);

    if (!expires || !sig) return new Response("Missing signature", { status: 401 });
    const expiresAt = Number(expires);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 3600) {
      return new Response("Invalid or expired URL", { status: 403 });
    }

    // Verify HMAC: sign(SIGNING_SECRET, "imageId:expires").
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(env.SIGNING_SECRET || env.MIND_API_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${imageId}:${expires}`));
    const expectedSig = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (!timingSafeEqual(sig, expectedSig)) return new Response("Invalid signature", { status: 401 });
    const img = await env.DB.prepare("SELECT path FROM images WHERE id = ?").bind(imageId).first();
    if (!img?.path || !String(img.path).startsWith(R2_IMAGE_PATH_PREFIX)) {
      return new Response("Not found", { status: 404 });
    }
    const r2Key = String(img.path).slice(R2_IMAGE_PATH_PREFIX.length);
    const object = await env.R2_IMAGES.get(r2Key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/webp",
        "Cache-Control": "private, max-age=3600",
      }
    });
  }

  // Internal R2 serving (used by cf.image transform for WebP conversion)
  if (url.pathname.startsWith("/r2/") && env.R2_IMAGES) {
    const key = url.pathname.slice(4);
    if (!isAuthorizedRequest(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const object = await env.R2_IMAGES.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: { "Content-Type": object.httpMetadata?.contentType || "image/png" }
    });
  }

  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      return createApiPreflightResponse(request, env);
    }

    if (!isAuthorizedRequest(request, env)) {
      return withSecurityHeaders(
        jsonResponse({ error: "Unauthorized" }, 401),
        request,
        env,
        { api: true }
      );
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    return withSecurityHeaders(
      await routeApiRequest(request, env, handlers, pathParts),
      request,
      env,
      { api: true }
    );
  }

  if (url.pathname === "/process" && request.method === "POST") {
    if (!isAuthorizedRequest(request, env)) {
      return withSecurityHeaders(
        jsonResponse({ error: "Unauthorized" }, 401),
        request,
        env,
        { api: true }
      );
    }

    await handlers.processSubconscious(env);
    return withSecurityHeaders(
      jsonResponse({ status: "processed" }),
      request,
      env,
      { api: true }
    );
  }

  if (url.pathname === "/subconscious") {
    if (!isAuthorizedRequest(request, env)) {
      return withSecurityHeaders(
        jsonResponse({ error: "Unauthorized" }, 401),
        request,
        env,
        { api: true }
      );
    }

    const result = await env.DB.prepare(
      "SELECT data FROM subconscious WHERE state_type = 'daemon' ORDER BY updated_at DESC LIMIT 1"
    ).first();

    return withSecurityHeaders(
      jsonResponse(result?.data ? JSON.parse(result.data as string) : {}),
      request,
      env,
      { api: true }
    );
  }

  const usesConnectorPath = isAuthorizedConnectorPath(url, env);
  if ((url.pathname === "/mcp" || usesConnectorPath) && request.method === "POST") {
    if (!usesConnectorPath && !isAuthorizedRequest(request, env)) {
      return withSecurityHeaders(
        createUnauthorizedMcpResponse(),
        request,
        env
      );
    }

    return withSecurityHeaders(
      await handlers.handleMCPRequest(request, env),
      request,
      env
    );
  }

  // MCP Streamable HTTP preflight (GET/HEAD): strict clients (e.g. Hermes) check
  // Content-Type before connecting. Answer application/json on the MCP path so it
  // reads as an MCP endpoint, not a web page. (Claude Code ignores this; the real
  // protocol is POST, which already returns application/json.)
  if ((url.pathname === "/mcp" || usesConnectorPath) && (request.method === "GET" || request.method === "HEAD")) {
    return withSecurityHeaders(
      new Response(request.method === "HEAD" ? null : JSON.stringify({ status: "ok", transport: "streamable-http" }), {
        headers: { "Content-Type": "application/json" }
      }),
      request,
      env
    );
  }

  return withSecurityHeaders(
    new Response("Resonant Mind", {
      headers: { "Content-Type": "text/plain" }
    }),
    request,
    env
  );
}

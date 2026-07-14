// HTTP handler for /api/threads — extracted from src/index.ts.
import { jsonResponse } from "../response";
import type { Env } from "../../types";

export async function handleApiThreads(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  const method = request.method;
  const threadId = pathParts[2] ? parseInt(pathParts[2]) : null;
  const action = pathParts[3];

  // Bare GET (list) was removed after review: the route was
  // pruned by Gate H (superseded by /api/active/open), and the dead branch
  // here interpolated the status query param straight into SQL — an
  // injection-shaped surface we don't leave lying around even unreachable.
  // GET-by-id, POST, resolve, PUT, DELETE below remain the live ops surface.

  if (method === "GET" && threadId) {
    const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first();
    return thread ? jsonResponse(thread) : jsonResponse({ error: "Not found" }, 404);
  }

  if (method === "POST" && !threadId) {
    const body = await request.json() as Record<string, unknown>;
    const result = await env.DB.prepare(
      "INSERT INTO threads (content, thread_type, priority, status, context) VALUES (?, ?, ?, 'active', ?)"
    ).bind(body.content, body.thread_type || "intention", body.priority || "medium", body.context || null).run();
    return jsonResponse({ id: result.meta.last_row_id, ...body }, 201);
  }

  if (method === "POST" && threadId && action === "resolve") {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE threads SET status = 'resolved', notes = COALESCE(notes, '') || ?, resolved_at = datetime('now') WHERE id = ?"
    ).bind("\n[Resolved] " + (body.resolution || ""), threadId).run();
    return jsonResponse({ id: threadId, status: "resolved" });
  }

  if (method === "PUT" && threadId) {
    const body = await request.json() as Record<string, unknown>;
    await env.DB.prepare(
      "UPDATE threads SET content = ?, priority = ?, status = ?, notes = ? WHERE id = ?"
    ).bind(body.content, body.priority, body.status, body.notes || null, threadId).run();
    return jsonResponse({ id: threadId, ...body });
  }

  if (method === "DELETE" && threadId) {
    await env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(threadId).run();
    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

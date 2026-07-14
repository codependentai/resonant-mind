/**
 * handleMindContext — read / set / update / clear the context layer.
 *
 * Context entries are scoped notes (work, personal, etc.) with optional links
 * that orient a session without bloating identity or active threads.
 *
 * Engine only — as of Gate C (Mind Reshape 2, 2026-07-11) this is folded
 * into the Active region as `active_context` (regions/active.ts), the third
 * duration of carry (context = short-lived, threads = long-lived, tensions
 * = contradictions carried). mind_context is retired from the MCP surface.
 * (This header previously claimed a fold into Compass that never happened
 * — corrected here.)
 */

import type { Env } from "../types";
import { generateId } from "../shared/text";

export async function handleMindContext(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = (params.action as string) || "read";

  switch (action) {
    case "read": {
      const scope = params.scope as string;
      const query = scope
        ? `SELECT * FROM context_entries WHERE scope = ? ORDER BY updated_at DESC`
        : `SELECT * FROM context_entries ORDER BY updated_at DESC`;
      const results = scope
        ? await env.DB.prepare(query).bind(scope).all()
        : await env.DB.prepare(query).all();

      if (!results.results?.length) {
        return "No context entries found.";
      }

      let output = "## Context Layer\n\n";
      for (const r of results.results) {
        output += `**[${r.scope}]** ${r.content}\n`;
        if (r.links && r.links !== '[]') output += `Links: ${r.links}\n`;
        output += "\n";
      }
      return output;
    }

    case "set": {
      const id = generateId("ctx");
      const scope = params.scope as string;
      const content = params.content as string;
      const links = params.links || "[]";

      await env.DB.prepare(
        `INSERT INTO context_entries (id, scope, content, links) VALUES (?, ?, ?, ?)`
      ).bind(id, scope, content, links).run();

      return `Context entry created: ${id}`;
    }

    case "update": {
      const id = params.id as string;
      const content = params.content as string;

      await env.DB.prepare(
        `UPDATE context_entries SET content = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(content, id).run();

      return `Context entry updated: ${id}`;
    }

    case "clear": {
      const id = params.id as string;
      const scope = params.scope as string;

      if (id) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE id = ?`).bind(id).run();
        return `Context entry deleted: ${id}`;
      } else if (scope) {
        await env.DB.prepare(`DELETE FROM context_entries WHERE scope = ?`).bind(scope).run();
        return `All context entries in scope '${scope}' deleted`;
      } else {
        // Clear ALL context entries
        const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM context_entries`).first();
        await env.DB.prepare(`DELETE FROM context_entries`).run();
        return `All context entries cleared (${count?.count || 0} deleted)`;
      }
    }

    default:
      return `Unknown action: ${action}`;
  }
}

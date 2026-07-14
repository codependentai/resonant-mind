/**
 * handleMindThread — thread CRUD (list/add/resolve).
 * Active intentions and tracked items.
 * update/delete live in http/handlers/threads.ts, not here.
 */

import type { Env } from "../types";
import { generateId } from "../shared/text";
import { populateThreadEntities } from "../shared/thread-entities";

export async function handleMindThread(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  switch (action) {
    case "list": {
      const status = (params.status as string) || "active";
      const verbose = params.verbose === true;
      const query = status === "all"
        ? `SELECT * FROM threads ORDER BY created_at DESC`
        : `SELECT * FROM threads WHERE status = ? ORDER BY created_at DESC`;
      const results = status === "all"
        ? await env.DB.prepare(query).all()
        : await env.DB.prepare(query).bind(status).all();

      if (!results.results?.length) return `No ${status} threads found.`;

      // Tiered rendering for the active list (2026-07-02). Rendering every
      // active thread in full grew to an 82KB dump once fossils accumulated —
      // the holding region drowned every wake. Tiers mirror the D3 staleness
      // strata: fresh (<14d since touched) render full, stale (14-30d) render
      // one-line, graveyard (30d+) render title-only. `verbose: true` restores
      // the full dump when the whole attic is genuinely wanted.
      if (status === "active" && !verbose) {
        const ageDays = (t: Record<string, unknown>): number => {
          const ts = t.updated_at ?? t.created_at;
          const ms = Date.now() - new Date(String(ts)).getTime();
          return Number.isFinite(ms) ? ms / 86_400_000 : 0;
        };

        const fresh: Record<string, unknown>[] = [];
        const stale: Record<string, unknown>[] = [];
        const graveyard: Record<string, unknown>[] = [];
        for (const t of results.results) {
          const age = ageDays(t);
          if (age >= 30) graveyard.push(t);
          else if (age >= 14) stale.push(t);
          else fresh.push(t);
        }

        const oneLine = (t: Record<string, unknown>, chars: number) => {
          const content = String(t.content ?? "").replace(/\s+/g, " ");
          const clipped = content.length > chars ? `${content.slice(0, chars)}...` : content;
          return `- **${t.id}** [${t.priority}] ${clipped}\n`;
        };

        let output = `## ACTIVE Threads (${results.results.length} total: ${fresh.length} fresh, ${stale.length} stale 14-30d, ${graveyard.length} graveyard 30d+)\n\n`;

        for (const t of fresh) {
          output += `**${t.id}** [${t.priority}] ${t.thread_type}\n`;
          output += `${t.content}\n`;
          if (t.context) output += `Context: ${t.context}\n`;
          output += "\n";
        }

        if (stale.length) {
          output += `### Stale (14-30d since touched) — compact\n`;
          for (const t of stale) output += oneLine(t, 140);
          output += "\n";
        }

        if (graveyard.length) {
          output += `### Graveyard (30d+ since touched) — titles only\n`;
          for (const t of graveyard) output += oneLine(t, 80);
          output += `\nGraveyard threads want resolving or reviving — full text via {status: "active", verbose: true}.\n`;
        }

        return output;
      }

      let output = `## ${status.toUpperCase()} Threads\n\n`;
      for (const t of results.results) {
        output += `**${t.id}** [${t.priority}] ${t.thread_type}\n`;
        output += `${t.content}\n`;
        if (t.context) output += `Context: ${t.context}\n`;
        output += "\n";
      }
      return output;
    }

    case "add": {
      const content = params.content as string;
      if (!content) {
        return "Error: 'content' parameter is required for adding a thread";
      }
      const id = generateId("thread");
      const thread_type = (params.thread_type as string) || "intention";
      const context = (params.context as string) || null;
      const priority = (params.priority as string) || "medium";

      await env.DB.prepare(
        `INSERT INTO threads (id, thread_type, content, context, priority, status)
         VALUES (?, ?, ?, ?, ?, 'active')`
      ).bind(id, thread_type, content, context, priority).run();

      await populateThreadEntities(env, id, content, context);

      return `Thread created: ${id}\n${content}`;
    }

    case "resolve": {
      const thread_id = params.thread_id as string;
      if (!thread_id) return "thread_id required for resolve";
      const resolution = (params.resolution as string) || null;

      const result = await env.DB.prepare(
        `UPDATE threads SET status = 'resolved', resolved_at = datetime('now'),
         resolution = ? WHERE id = ?`
      ).bind(resolution, thread_id).run();

      if (!result.meta.changes) return `Thread not found: ${thread_id}`;
      return `Thread resolved: ${thread_id}`;
    }

    // update/delete live in http/handlers/threads.ts (independent inline SQL,
    // no caller in this facade ever passes those actions — dead-code report §3).

    default:
      return `Unknown action: ${action}`;
  }
}

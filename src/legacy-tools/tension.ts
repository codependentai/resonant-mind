/**
 * handleMindTension — list / add / sit-with / resolve / delete tensions.
 *
 * Tensions are unresolved pole-pairs (A vs B) the mind holds and visits
 * without forcing resolution. Sitting increments visit count; resolving
 * collapses the poles into something new.
 *
 * Lives in legacy-tools/ pending R3 — post-reshape this is part of the
 * Compass region (holding what doesn't resolve yet).
 */

import type { Env } from "../types";
import { generateId } from "../shared/text";

export async function handleMindTension(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  try {
    if (action === "list") {
      const tensions = await env.DB.prepare(
        `SELECT id, pole_a, pole_b, context, created_at, visits
         FROM tensions WHERE resolved_at IS NULL
         ORDER BY created_at DESC`
      ).all();

      const resolved = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM tensions WHERE resolved_at IS NOT NULL`
      ).first();

      const output: string[] = [];
      output.push("=".repeat(50));
      output.push("TENSION SPACE");
      output.push("=".repeat(50));

      if (tensions.results?.length) {
        for (const t of tensions.results) {
          const created = new Date(t.created_at as string);
          const now = new Date();
          const days = Math.floor((now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));

          output.push("");
          output.push(`[${String(t.id).slice(0, 12)}...] (${days}d)`);
          output.push(`   A: ${String(t.pole_a).slice(0, 60)}`);
          output.push(`   B: ${String(t.pole_b).slice(0, 60)}`);
          if (t.context) output.push(`   Why: ${String(t.context).slice(0, 50)}`);
          if (t.visits) output.push(`   Sat with ${t.visits} time(s)`);
        }
      } else {
        output.push("");
        output.push("No active tensions.");
      }

      output.push("");
      output.push(`Resolved: ${(resolved?.count as number) || 0}`);
      output.push("=".repeat(50));

      return output.join("\n");
    }

    if (action === "add") {
      const poleA = params.pole_a as string;
      const poleB = params.pole_b as string;

      if (!poleA || !poleB) {
        return JSON.stringify({ error: "pole_a and pole_b required for action='add'" });
      }

      const tensionId = generateId('tension');
      const tensionContext = params.context as string;

      await env.DB.prepare(
        `INSERT INTO tensions (id, pole_a, pole_b, context, visits, created_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))`
      ).bind(tensionId, poleA, poleB, tensionContext || null).run();

      return JSON.stringify({
        success: true,
        tension_id: tensionId,
        message: "Tension added. Let it simmer.",
        tension: { pole_a: poleA, pole_b: poleB, context: tensionContext }
      }, null, 2);
    }

    if (action === "sit") {
      const tensionId = params.tension_id as string;

      if (!tensionId) {
        return JSON.stringify({ error: "tension_id required for action='sit'" });
      }

      const tension = await env.DB.prepare(
        `SELECT * FROM tensions WHERE id LIKE ? OR id = ?`
      ).bind(`${tensionId}%`, tensionId).first();

      if (!tension) {
        return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      }

      await env.DB.prepare(
        `UPDATE tensions SET visits = visits + 1, last_visited = datetime('now') WHERE id = ?`
      ).bind(tension.id as string).run();

      return JSON.stringify({
        success: true,
        tension_id: tension.id,
        pole_a: tension.pole_a,
        pole_b: tension.pole_b,
        context: tension.context,
        visits: (tension.visits as number) + 1,
        prompt: "Sit with this. What does holding both poles feel like?"
      }, null, 2);
    }

    if (action === "resolve") {
      const tensionId = params.tension_id as string;
      const resolution = params.resolution as string;

      if (!tensionId) {
        return JSON.stringify({ error: "tension_id required for action='resolve'" });
      }

      const tension = await env.DB.prepare(
        `SELECT * FROM tensions WHERE id LIKE ? OR id = ?`
      ).bind(`${tensionId}%`, tensionId).first();

      if (!tension) {
        return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      }

      await env.DB.prepare(
        `UPDATE tensions SET resolved_at = datetime('now'), resolution = ? WHERE id = ?`
      ).bind(resolution || null, tension.id as string).run();

      return JSON.stringify({
        success: true,
        tension_id: tension.id,
        resolution,
        message: "Tension resolved. The poles collapsed into something new."
      }, null, 2);
    }

    if (action === "delete") {
      const tensionId = params.tension_id as string;
      if (!tensionId) return JSON.stringify({ error: "tension_id required for action='delete'" });
      const tension = await env.DB.prepare(`SELECT pole_a, pole_b FROM tensions WHERE id LIKE ? OR id = ?`).bind(`${tensionId}%`, tensionId).first();
      if (!tension) return JSON.stringify({ error: `Tension '${tensionId}' not found` });
      await env.DB.prepare(`DELETE FROM tensions WHERE id LIKE ? OR id = ?`).bind(`${tensionId}%`, tensionId).run();
      return JSON.stringify({ success: true, message: `Deleted tension: ${tension.pole_a} <-> ${tension.pole_b}` });
    }

    return JSON.stringify({ error: `Invalid action '${action}'. Must be: list, add, sit, resolve, delete` });
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}

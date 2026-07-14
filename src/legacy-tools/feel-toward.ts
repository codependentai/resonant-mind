/**
 * handleMindFeelToward — relational state CRUD.
 * Record/read/clear feelings toward specific people.
 */

import type { Env } from "../types";

export async function handleMindFeelToward(env: Env, params: Record<string, unknown>): Promise<string> {
  const person = params.person as string;
  const feeling = params.feeling as string;
  const intensity = params.intensity as string;

  if (!person) {
    return "Error: 'person' parameter is required";
  }

  // Clear all relational state for this person
  const clear = params.clear as boolean;
  const clearId = params.clear_id as number;

  if (clear) {
    const count = await env.DB.prepare(`SELECT COUNT(*) as c FROM relational_state WHERE person = ?`).bind(person).first();
    await env.DB.prepare(`DELETE FROM relational_state WHERE person = ?`).bind(person).run();
    return `Cleared ${count?.c || 0} relational state entries for ${person}`;
  }

  if (clearId) {
    await env.DB.prepare(`DELETE FROM relational_state WHERE id = ? AND person = ?`).bind(clearId, person).run();
    return `Deleted relational state entry #${clearId} for ${person}`;
  }

  // If feeling provided, record new state
  if (feeling) {
    const validIntensity = intensity || "present";
    await env.DB.prepare(
      `INSERT INTO relational_state (person, feeling, intensity) VALUES (?, ?, ?)`
    ).bind(person, feeling, validIntensity).run();
    return `Relational state recorded: feeling ${feeling} (${validIntensity}) toward ${person}`;
  }

  // Otherwise, read current state for this person
  const states = await env.DB.prepare(
    `SELECT feeling, intensity, timestamp FROM relational_state
     WHERE person = ? ORDER BY timestamp DESC LIMIT 10`
  ).bind(person).all();

  if (!states.results?.length) {
    return `No relational state recorded for ${person}`;
  }

  let output = `## Relational State: ${person}\n\n`;
  for (const s of states.results) {
    output += `- **${s.feeling}** (${s.intensity}) — ${s.timestamp}\n`;
  }
  return output;
}

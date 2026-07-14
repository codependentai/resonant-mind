/**
 * thread_entities helper — populate the join table on thread writes.
 *
 * Mirrors the substring-match logic the bond_enter handler used to do at
 * read time. Run once at write time so reads are indexed lookups.
 */

import type { Env } from "../types";

export async function populateThreadEntities(
  env: Env,
  threadId: string,
  content: string,
  context?: string | null
): Promise<void> {
  const search = `${content || ""}\n${context || ""}`.toLowerCase();
  if (!search.trim()) return;

  const peopleResult = await env.DB.prepare(
    `SELECT id, name FROM people WHERE length(name) >= 3`
  ).all();
  const people = (peopleResult.results || []) as Array<{ id: number; name: string }>;

  for (const p of people) {
    if (!search.includes(p.name.toLowerCase())) continue;
    await env.DB.prepare(
      `INSERT INTO thread_entities (thread_id, entity_id, role)
       VALUES ($1, $2, 'mentioned')
       ON CONFLICT (thread_id, entity_id, role) DO NOTHING`
    ).bind(threadId, p.id).run();
  }
}

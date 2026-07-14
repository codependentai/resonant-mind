/**
 * handleMindReadEntity — read a single entity with observations and relations.
 * Tracks access.
 *
 * The engine under regions/network.ts's `graph_look` verb (Gate A, Mind
 * Reshape 2). graph_look wraps this with the Gate N #2 person rule and
 * Gate F affect-line surfacing — this file has no knowledge of either.
 *
 * collision-audit.md E-3: nominally a read, but recordAccessTracking below is
 * a real hidden write (access_count/last_accessed_at on the returned
 * observations). Same class as mind_search/mind_store_image{view} — flagged
 * so no future "read tools are side-effect-free" assumption gets built on top
 * of the description alone.
 */

import type { Env } from "../types";
import { recordAccessTracking } from "../daemon/state";

export async function handleMindReadEntity(env: Env, params: Record<string, unknown>): Promise<string> {
  const name = params.name as string;
  const context = params.context as string;

  // Find the entity (globally unique by name now)
  const entity = await env.DB.prepare(
    `SELECT id, name, entity_type, primary_context, salience, created_at FROM entities WHERE name = ?`
  ).bind(name).first() as any;

  if (!entity) {
    return `Entity '${name}' not found.`;
  }

  // Get observations, optionally filtered by context
  let observations;
  if (context) {
    observations = await env.DB.prepare(
      `SELECT id, content, salience, emotion, weight, context, added_at FROM observations WHERE entity_id = ? AND context = ? AND (valid_until IS NULL AND superseded_by IS NULL) ORDER BY added_at DESC`
    ).bind(entity.id, context).all();
  } else {
    observations = await env.DB.prepare(
      `SELECT id, content, salience, emotion, weight, context, added_at FROM observations WHERE entity_id = ? AND (valid_until IS NULL AND superseded_by IS NULL) ORDER BY added_at DESC`
    ).bind(entity.id).all();
  }

  // Track access for read entity observations
  const readObsIds = (observations.results || []).map((o: any) => o.id as number).filter(Boolean);
  recordAccessTracking(env, readObsIds).catch(() => {});

  // Get relations where this entity is the source
  const relationsFrom = await env.DB.prepare(
    `SELECT to_entity, relation_type, to_context FROM relations WHERE from_entity = ?`
  ).bind(name).all();

  // Get relations where this entity is the target
  const relationsTo = await env.DB.prepare(
    `SELECT from_entity, relation_type, from_context FROM relations WHERE to_entity = ?`
  ).bind(name).all();

  // Build output
  let output = `## ${entity.name}\n`;
  output += `**Type:** ${entity.entity_type} | **Context:** ${entity.primary_context}\n\n`;

  output += `### Observations (${observations.results?.length || 0})\n`;
  if (observations.results?.length) {
    for (const obs of observations.results) {
      const emotion = obs.emotion ? ` [${obs.emotion}]` : '';
      output += `- ${obs.content}${emotion}\n`;
    }
  } else {
    output += '_No observations_\n';
  }

  output += `\n### Relations\n`;
  const totalRelations = (relationsFrom.results?.length || 0) + (relationsTo.results?.length || 0);
  if (totalRelations === 0) {
    output += '_No relations_\n';
  } else {
    if (relationsFrom.results?.length) {
      output += '**Outgoing:**\n';
      for (const rel of relationsFrom.results) {
        output += `- --[${rel.relation_type}]--> ${rel.to_entity}\n`;
      }
    }
    if (relationsTo.results?.length) {
      output += '**Incoming:**\n';
      for (const rel of relationsTo.results) {
        output += `- <--[${rel.relation_type}]-- ${rel.from_entity}\n`;
      }
    }
  }

  return output;
}

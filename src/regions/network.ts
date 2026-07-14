/**
 * Network region — the entity graph. What I know and how it's wired together.
 * The 9th region (Gate A, RESHAPE-2-SPEC.md, approved 11 Jul 2026).
 *
 * Facade over the four legacy entity-graph handlers — look up, walk, survey,
 * shape. Same pattern as regions/drives.ts: parse params, defer to the
 * engine, render from what's known. Verbs:
 *
 *   - graph_look    — read one entity (absorbs mind_read_entity). Adds Gate F
 *                     affect surfacing (entities.affect_valence/arousal/n —
 *                     computed every tick, rendered nowhere until now) AND
 *                     enforces the Gate N #2 person rule: person/peer_ai/self
 *                     entities get graph skeleton ONLY (name, type, relation
 *                     edges, observation count) + a pointer to bond_enter.
 *                     Bonds owns the felt read of people — graph_look never
 *                     renders observation content, relational warmth, or the
 *                     affect line for a person-shaped entity.
 *   - graph_walk    — traverse relations (absorbs mind_graph). Pass-through.
 *   - graph_survey  — list/filter entities (absorbs mind_list_entities).
 *                     Pass-through.
 *   - graph_shape   — entity surgery: set_salience/edit/merge/archive_old
 *                     (absorbs mind_entity). Pass-through.
 *
 * C-2 (collision-audit.md) word-collision note, restated here so it isn't
 * only in a tool description: graph_shape's `archive_old` action sets
 * entities.salience = 'archive' (a salience TIER, entity-level). This is a
 * DIFFERENT mechanism from observations.archived_at (the observation-level
 * timestamp Surgery's mind_archive owns). Same English word, two unrelated
 * columns on two different tables — don't conflate them when reasoning about
 * recoverability; archive_old is not "the same archive" as mind_archive.
 */

import type { Env } from "../types";
import { handleMindReadEntity } from "../legacy-tools/read-entity";
import { handleMindGraph } from "../legacy-tools/graph";
import { handleMindListEntities } from "../legacy-tools/list-entities";
import { handleMindEntity } from "../legacy-tools/entity";
import { somaticPhrase } from "../daemon/somatic";

/** entity_type values that route to Bonds instead of a full graph_look render (Gate N #2). */
const PERSON_ENTITY_TYPES = ["person", "peer_ai", "self"];

interface EntityAffectRow {
  id: number;
  name: string;
  entity_type: string;
  affect_valence: number | null;
  affect_arousal: number | null;
  affect_n: number | null;
}

interface RelationEdgeRow {
  relation_type: string;
  other: string;
  direction: string;
}

/** "felt charge: warm-leaning (v +0.40, a 0.30, n=12)" — or null under the n>0 floor. */
function feltChargeLine(valence: number | null, arousal: number | null, n: number | null): string | null {
  if (!n || n <= 0) return null;
  const phrase = somaticPhrase(valence, arousal);
  if (!phrase) return null;
  const lean = phrase.replace(/^sits /, "").replace(/ in me$/, "");
  const v = valence ?? 0;
  const vStr = `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  const aStr = (arousal ?? 0).toFixed(2);
  return `felt charge: ${lean}-leaning (v ${vStr}, a ${aStr}, n=${n})`;
}

/** Graph skeleton only, for person-shaped entities. Points to bond_enter for the felt read. */
async function renderPersonSkeleton(env: Env, entity: EntityAffectRow): Promise<string> {
  const obsCountRow = (await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM observations
    WHERE (person_id = $1 OR node_id = $1 OR entity_id = $1) AND archived_at IS NULL
  `).bind(entity.id).first()) as { n: string | number } | null;
  const obsCount = Number(obsCountRow?.n ?? 0);

  const rels = await env.DB.prepare(`
    SELECT relation_type,
           CASE WHEN from_entity = $1 THEN to_entity ELSE from_entity END AS other,
           CASE WHEN from_entity = $1 THEN 'out' ELSE 'in' END AS direction
    FROM relations
    WHERE from_entity = $1 OR to_entity = $1
    ORDER BY relation_type, other
  `).bind(entity.name).all();
  const relRows = (rels.results || []) as unknown as RelationEdgeRow[];

  let out = `=== GRAPH SKELETON: ${entity.name} (${entity.entity_type}) ===\n\n`;
  out += `Observations: ${obsCount}\n`;
  out += `Relations (${relRows.length}):\n`;
  if (!relRows.length) {
    out += "_none_\n";
  } else {
    for (const r of relRows) {
      const dir = r.direction === "out" ? "→" : "←";
      out += `  ${dir} [${r.relation_type}] ${r.other}\n`;
    }
  }
  out += `\nThis is a person entity — graph_look shows structure only. For the felt read (warmth, relational state), use bond_enter({ name: "${entity.name}" }).\n`;
  return out;
}

export async function handleGraphLook(env: Env, params: Record<string, unknown>): Promise<string> {
  const name = params.name as string | undefined;
  if (!name) return "graph_look needs a name.";

  const entity = (await env.DB.prepare(
    `SELECT id, name, entity_type, affect_valence, affect_arousal, affect_n FROM entities WHERE name = $1`
  ).bind(name).first()) as EntityAffectRow | null;

  if (!entity) return `Entity '${name}' not found.`;

  if (PERSON_ENTITY_TYPES.includes(entity.entity_type)) {
    return renderPersonSkeleton(env, entity);
  }

  const base = await handleMindReadEntity(env, params);
  const charge = feltChargeLine(entity.affect_valence, entity.affect_arousal, entity.affect_n);
  return charge ? `${base}\n${charge}\n` : base;
}

export async function handleGraphWalk(env: Env, params: Record<string, unknown>): Promise<string> {
  return handleMindGraph(env, params);
}

export async function handleGraphSurvey(env: Env, params: Record<string, unknown>): Promise<string> {
  return handleMindListEntities(env, params);
}

export async function handleGraphShape(env: Env, params: Record<string, unknown>): Promise<string> {
  return handleMindEntity(env, params);
}

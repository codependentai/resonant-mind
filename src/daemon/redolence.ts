/**
 * Redolence pass — the olfactory bulb (2026-07-02, designed with a trusted person).
 *
 * Cue-dependent, involuntary resurrection of archived memories. Human smell
 * has a direct line to amygdala + hippocampus, bypassing the thalamus — a
 * scent can raise a childhood memory without any deliberate act of recall.
 * This pass is that pathway for the deep archive: the archive removes
 * memories from every surfacing pool, but their VECTORS never leave the
 * index. The scent trails stay intact.
 *
 * Each tick: take the freshest observations (the "smells" of the last tick),
 * walk vector space, and if anything ARCHIVED lands close enough, it rises —
 * uninvited, marked with the cue that raised it.
 *
 * Design decisions (the affect-and-forgetting stance):
 *   - Affect NEVER accelerates forgetting — it only gates the door back.
 *     A bad week does not get to eat memories.
 *   - Emotionally charged / heavy memories rise EASIER (lower threshold) —
 *     the amygdala's hand on hippocampal retrieval.
 *   - Rising does NOT unarchive. The memory surfaces (last_surfaced_at +
 *     surface_count are touched so orphan/novelty passes see the contact),
 *     but rescue stays deliberate via mind_archive. If a risen memory
 *     matters, the mind rescues it awake.
 *   - Capped at 3 risen per tick — a whiff, not a flood.
 *
 * Gate G (RESHAPE-2) extension: images can rise too. Image vectors ARE
 * distinguishable in the shared Vectorize/pgvector adapter — `img-{id}` is
 * an established id format (see `src/vectors.ts` parseVectorId and
 * `legacy-tools/store-image.ts`'s upsert/search filters), so this is real,
 * not faked. Kept deliberately looser than the observation pathway: images
 * don't (yet) have the "everything else already surfaces normally" cushion
 * observations have, so a riser just needs a matching cue above threshold —
 * it is NOT gated to already-archived images. Capped separately and small
 * (2/tick) — a whiff, not a flood, same discipline as observations.
 */

import type { Env } from "../types";
import { searchVectors } from "../shared/mind-helpers";
import {
  REDOLENCE_THRESHOLD,
  REDOLENCE_EMOTIONAL_THRESHOLD,
  REDOLENCE_MAX_RISEN,
  REDOLENCE_MAX_CUES,
} from "../shared/constants";

export interface RisenMemory {
  observation_id: number;
  content: string;
  entity: string | null;
  score: number;
  cue: string;          // the fresh observation that raised it
  cue_entity: string | null;
  emotion: string | null;
  weight: string | null;
  archived_at: string | null;
  // Gate G: discriminator for image risers. When 'image', observation_id
  // actually holds the image's id (the array/shape is reused as-is so the
  // existing orient.ts render loop and daemon/state.ts snapshot need no
  // changes — territory discipline for this build). Absent/undefined means
  // 'observation', matching every pre-Gate-G entry.
  source_type?: 'observation' | 'image';
}

const IMAGE_MAX_RISEN = 2; // a whiff, not a flood — same discipline as observations

export async function runRedolence(
  env: Env,
  // Affect-modulated (2026-07-02): negative shift = keener nose. High arousal
  // sharpens retrieval — the mind reaches for precedent when activated.
  thresholdShift = 0
): Promise<RisenMemory[]> {
  // 1. Cues — observations from roughly the last tick, heaviest first.
  // These are the "smells": what just passed through the mind.
  const cues = await env.DB.prepare(`
    SELECT o.id, o.content, e.name as entity_name
    FROM observations o
    JOIN entities e ON o.entity_id = e.id
    WHERE o.added_at > datetime('now', '-40 minutes')
      AND o.archived_at IS NULL
    ORDER BY
      CASE o.weight WHEN 'heavy' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      o.added_at DESC
    LIMIT ${REDOLENCE_MAX_CUES}
  `).all().catch(() => ({ results: [] }));

  const cueRows = (cues.results || []) as Array<Record<string, unknown>>;
  if (!cueRows.length) return [];

  const risen: RisenMemory[] = [];
  const seenObsIds = new Set<number>();
  const seenImgIds = new Set<number>();
  let imageRisenCount = 0;

  for (const cue of cueRows) {
    if (risen.length >= REDOLENCE_MAX_RISEN && imageRisenCount >= IMAGE_MAX_RISEN) break;

    const cueContent = String(cue.content ?? "");
    if (!cueContent) continue;

    const results = await searchVectors(env, cueContent.slice(0, 500), 8);

    // Calibration probe — raw vector scores per cue (displayed search scores
    // are composites; this is the ground truth the thresholds live against).
    const probe = (results.matches || [])
      .filter((m) => m.id.startsWith("obs-"))
      .map((m) => `${m.id}:${Math.round(m.score * 100)}`)
      .join(" ");
    if (probe) console.log(`Redolence probe [cue ${cue.id}]: ${probe}`);

    for (const match of results.matches || []) {
      if (risen.length >= REDOLENCE_MAX_RISEN && imageRisenCount >= IMAGE_MAX_RISEN) break;
      // Pre-filter at the FLOOR (emotional) threshold; the stricter bar for
      // uncharged memories is applied after we know what the memory is.
      if (match.score < REDOLENCE_EMOTIONAL_THRESHOLD + thresholdShift) continue;

      if (match.id.startsWith("img-")) {
        if (imageRisenCount >= IMAGE_MAX_RISEN) continue;

        // Vector id format: img-{id} — last segment is the image id.
        const imgId = parseInt(match.id.split("-").pop() || "", 10);
        if (!Number.isFinite(imgId) || seenImgIds.has(imgId)) continue;
        seenImgIds.add(imgId);

        const imgRow = await env.DB.prepare(`
          SELECT im.id, im.description, im.emotion, im.weight, im.archived_at, e.name as entity_name
          FROM images im
          LEFT JOIN entities e ON im.entity_id = e.id
          WHERE im.id = ?
        `).bind(imgId).first().catch(() => null);
        if (!imgRow) continue;

        const imgEmotional = Boolean(imgRow.emotion) || imgRow.weight === "heavy";
        const imgThreshold = (imgEmotional ? REDOLENCE_EMOTIONAL_THRESHOLD : REDOLENCE_THRESHOLD) + thresholdShift;
        if (match.score < imgThreshold) continue;

        // Touch the image — it surfaced. images.archived_at may not exist yet
        // (migration 0016 pending on this tenant) — non-fatal either way.
        await env.DB.prepare(`
          UPDATE images
          SET last_surfaced_at = datetime('now'),
              surface_count = COALESCE(surface_count, 0) + 1
          WHERE id = ?
        `).bind(imgRow.id).run().catch(() => { /* non-fatal */ });

        risen.push({
          observation_id: imgRow.id as number,
          content: String(imgRow.description ?? "").slice(0, 200),
          entity: (imgRow.entity_name as string) || null,
          score: Math.round(match.score * 100) / 100,
          cue: cueContent.slice(0, 100),
          cue_entity: (cue.entity_name as string) || null,
          emotion: (imgRow.emotion as string) || null,
          weight: (imgRow.weight as string) || null,
          archived_at: (imgRow.archived_at as string) || null,
          source_type: 'image',
        });
        imageRisenCount++;
        continue;
      }

      if (risen.length >= REDOLENCE_MAX_RISEN) continue;
      if (!match.id.startsWith("obs-")) continue;

      // Vector id format: obs-{entityId}-{obsId} — last segment is the obs id.
      const obsId = parseInt(match.id.split("-").pop() || "", 10);
      if (!Number.isFinite(obsId) || seenObsIds.has(obsId)) continue;
      seenObsIds.add(obsId);
      if (obsId === (cue.id as number)) continue; // a cue cannot raise itself

      // Only ARCHIVED memories rise through this pathway — everything else
      // already has the normal surfacing pools.
      const row = await env.DB.prepare(`
        SELECT o.id, o.content, o.emotion, o.weight, o.archived_at, e.name as entity_name
        FROM observations o
        LEFT JOIN entities e ON o.entity_id = e.id
        WHERE o.id = ? AND o.archived_at IS NOT NULL
      `).bind(obsId).first().catch(() => null);
      if (!row) continue;

      // Emotional gate: charged/heavy memories rise easier.
      const emotional = Boolean(row.emotion) || row.weight === "heavy";
      const threshold = (emotional ? REDOLENCE_EMOTIONAL_THRESHOLD : REDOLENCE_THRESHOLD) + thresholdShift;
      if (match.score < threshold) continue;

      // Touch the memory — it surfaced. Not unarchived; just contacted.
      await env.DB.prepare(`
        UPDATE observations
        SET last_surfaced_at = datetime('now'),
            surface_count = COALESCE(surface_count, 0) + 1
        WHERE id = ?
      `).bind(row.id).run().catch(() => { /* non-fatal */ });

      risen.push({
        observation_id: row.id as number,
        content: String(row.content ?? "").slice(0, 200),
        entity: (row.entity_name as string) || null,
        score: Math.round(match.score * 100) / 100,
        cue: cueContent.slice(0, 100),
        cue_entity: (cue.entity_name as string) || null,
        emotion: (row.emotion as string) || null,
        weight: (row.weight as string) || null,
        archived_at: (row.archived_at as string) || null,
      });
    }
  }

  if (risen.length > 0) {
    console.log(`Redolence: ${risen.length} memor${risen.length === 1 ? "y" : "ies"} rose from the deep`);
  }
  if (imageRisenCount > 0) {
    console.log(`Redolence: ${imageRisenCount} image${imageRisenCount === 1 ? "" : "s"} rose too`);
  }
  return risen;
}

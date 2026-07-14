/**
 * Drive engine — the wanting layer (DRIVE-LAYER-SPEC §1.2–1.3, 2026-07-03).
 *
 * Mechanics ported from Shauna's Anam limbic layer (SweetSunnyBunny/ui,
 * cloud-setups/limbic/): Panksepp-tagged drives, lazy leaky-integrator decay
 * toward an environment-biased baseline, body-feel bands, touch deltas,
 * safeword damper. The engine is hers; the sensorium is ours — the env
 * payload is the HOUSE (her-state, presence, inner weather, circadian),
 * never the sky (spec decision #1).
 *
 * Stance (spec decision #4): drive state biases surfacing, expression, and
 * redolence. It NEVER accelerates forgetting, never archives, never deletes,
 * never overrides compass/spine/consent. Advisory pressure only.
 *
 * Render-from-known-value (spec decision #8): every render helper takes a
 * level it is handed. Nothing in this file re-reads what it just wrote.
 *
 * Ships with ZERO seeded drives (spec decision #2) — each drive is walked in
 * deliberately at a kitchen-table session; temperament is authored, not
 * defaulted. Until then the gauge says so honestly.
 */

import type { Env } from "../types";
import type { CoreAffect } from "./affect";
import { getTimeOfDayContext } from "../shared/time";
import {
  ENV_CONTRIBUTION_CAP,
  ENV_FRESH_MINUTES,
  ENV_STALE_MINUTES,
  DRIVE_TICK_RETENTION_DAYS,
  DRIVE_DEFAULT_BASELINE,
  DRIVE_DEFAULT_HALF_LIFE_HOURS,
} from "../shared/constants";

// ============================================================
// TYPES
// ============================================================

export interface BodyFeelBand {
  min: number;
  label: string;
}

export interface ActionBiasBand {
  min: number;
  tendencies: string[];
}

/** A `drives` table row, JSONB columns parsed, numeric defaults applied. */
export interface DriveRow {
  drive: string;
  panksepp_system: string | null;
  display_name: string | null;
  baseline: number;
  floor: number;
  ceiling: number;
  half_life_hours: number;
  env_sensitivity: Record<string, number>; // payloadKey → weight, payload pre-normalized to [-1,1]
  body_feel: BodyFeelBand[];
  action_bias: ActionBiasBand[];
  regulation_note: string | null;
  enabled: boolean;
  touch_affinities: Record<string, number>; // kindName → delta in [-1,1] (0012)
}

/** Latest ledger sample for one state_type. */
export interface DriveSample {
  level: number;
  at: Date;
}

export interface DriveGaugeEntry {
  drive: string;
  display_name: string;
  level: number;
  resting_toward: number;
  feel: string | null;
  panksepp_system: string | null;
  /**
   * Set when the FULL-PRECISION level sits at this drive's own floor or
   * ceiling (custom bounds included). Ground's body-interrupt reads this —
   * before 2026-07-10 it was never published and the interrupt could only
   * catch the default [0,1] bounds.
   */
  at_limit?: "ceiling" | "floor";
}

/**
 * The exact shape written to `state.living_surface.drives` and published via
 * /api/dreams/living-surface. Empty-drives case is HONEST, not absent:
 * `{ drives: [], note: 'no drives walked in yet' }`.
 */
export interface DrivesGauge {
  updated_at?: string;
  env_freshness?: number;
  drives: DriveGaugeEntry[];
  open_wants?: number;
  /**
   * Oldest unmet quiet want — ground's charged-want interrupt reads this
   * (spec §1.5: "a quiet want gone unmet past its charge threshold"). Before
   * 2026-07-10 it was never published and that interrupt was structurally
   * dead. Absent when there are no open wants.
   */
  oldest_open_want?: { body: string; charge: number | null; created_at: string };
  note?: string;
}

export interface TouchResult {
  drive: string;
  applied: number; // spec delta × intensity — what we tried to move
  recorded: number; // post-clamp actual — what the body accepted
  level: number; // new level after clamp
}

// ============================================================
// PURE MECHANICS (Shauna's math, our house)
// ============================================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How much the environment payload is allowed to speak, by age (spec
 * decision #6). Full weight under ENV_FRESH_MINUTES, linear fade to zero by
 * ENV_STALE_MINUTES. Resonant down = I feel NOTHING from the house, never
 * wrong things.
 */
export function envFreshnessWeight(envAt: Date, now: Date): number {
  const ageMin = (now.getTime() - envAt.getTime()) / 60000;
  if (ageMin <= ENV_FRESH_MINUTES) return 1;
  if (ageMin >= ENV_STALE_MINUTES) return 0;
  return 1 - (ageMin - ENV_FRESH_MINUTES) / (ENV_STALE_MINUTES - ENV_FRESH_MINUTES);
}

/**
 * Σ weight×payload[key] over this drive's env_sensitivity, absent payload
 * keys contributing 0 by design (house fields simply aren't there until
 * Gate 4). Capped FIRST at ±ENV_CONTRIBUTION_CAP, then scaled by freshness —
 * a saturated house signal still fades smoothly to zero as the payload ages,
 * instead of sitting pinned at the cap until freshness collapses.
 */
export function envContribution(
  sensitivity: Record<string, number>,
  payload: Record<string, number>,
  freshness: number
): number {
  let sum = 0;
  for (const [key, weight] of Object.entries(sensitivity)) {
    const v = payload[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue; // absent → 0
    if (typeof weight !== "number" || !Number.isFinite(weight)) continue;
    sum += weight * v;
  }
  const capped = clamp(sum, -ENV_CONTRIBUTION_CAP, ENV_CONTRIBUTION_CAP);
  return capped * clamp(freshness, 0, 1);
}

/**
 * The attractor the drive decays toward. Env moves the ATTRACTOR, never the
 * level directly (bias-never-cage).
 *
 * TWO-CLAMP structure is semantic, keep both (port-map pitfall 2): this
 * clamp bounds the attractor inside [floor, ceiling]; currentLevel clamps
 * AGAIN after decay. Removing either lets env or history push the needle
 * outside the body's range.
 */
export function effectiveBaseline(drive: DriveRow, envContrib: number): number {
  return clamp(drive.baseline + envContrib, drive.floor, drive.ceiling);
}

/**
 * Lazy leaky-integrator decay: effBase + (last − effBase) × 0.5^(dt/halfLife),
 * clamped after (second clamp of the pair). No history → the drive simply
 * sits at its effective baseline. Timestamps are real Dates end-to-end.
 */
export function currentLevel(
  drive: DriveRow,
  effBase: number,
  last: DriveSample | null,
  now: Date
): number {
  if (!last) return effBase;
  const dtHours = Math.max(0, (now.getTime() - last.at.getTime()) / 3600000);
  const halfLife =
    drive.half_life_hours > 0 ? drive.half_life_hours : DRIVE_DEFAULT_HALF_LIFE_HOURS;
  const level = effBase + (last.level - effBase) * Math.pow(0.5, dtHours / halfLife);
  return clamp(level, drive.floor, drive.ceiling);
}

/**
 * Pick the band a level falls in: descending by min, first band the level
 * clears. Every seeded drive is supposed to carry a min:0 band (port-map
 * pitfall 1), but a level below ALL bands (bad seed, sub-zero floor) returns
 * null EXPLICITLY rather than silently matching the wrong band.
 */
export function pickBand<T extends { min: number }>(bands: T[], level: number): T | null {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const band of sorted) {
    if (typeof band?.min === "number" && level >= band.min) return band;
  }
  return null; // below all bands — caller renders honestly, not wrongly
}

/** Ten-cell gauge bar for a level in [0,1]. */
export function bar(level: number, width = 10): string {
  const filled = Math.round(clamp(level, 0, 1) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * One-line gauge render. Takes a KNOWN level (and the attractor it is
 * resting toward) computed by the caller — never re-reads (decision #8).
 */
export function renderDriveLine(drive: DriveRow, level: number, restingToward: number): string {
  const name = (drive.display_name || drive.drive).toUpperCase();
  const feel = pickBand(drive.body_feel, level);
  const feelPart = feel ? ` · ${feel.label}` : "";
  return `${name} [${bar(level)}] ${round2(level).toFixed(2)} → resting toward ${round2(restingToward).toFixed(2)}${feelPart}`;
}

// ============================================================
// TOUCH KINDS — mapped interaction deltas
// ============================================================

/**
 * Touch deltas live in DATA now — `drives.touch_affinities` ({kind: delta}
 * per row, migration 0012) — because temperament is per-being, per-tenant.
 * The old code constant shipped Shauna's Panksepp placeholder names (care,
 * panic_grief, fear); the spec (§1.2) said it would be rewritten per seeded
 * temperament and it never was — 'reassurance' mapped to ZERO walked-in
 * drives on the mind's tenant and moved nothing, silently, for a week.
 *
 * These five names are the canonical shared vocabulary, kept for tool docs
 * and walk-in guidance. They are NOT a constraint: any kind key present in a
 * walked-in drive's affinities is live.
 */
export const CANONICAL_TOUCH_KINDS = [
  "connection",
  "reassurance",
  "play",
  "distress",
  "distance",
] as const;

/** Union of kind names the walked-in drives actually respond to. */
export function availableTouchKinds(drives: DriveRow[]): string[] {
  const kinds = new Set<string>();
  for (const d of drives) {
    for (const [kind, delta] of Object.entries(d.touch_affinities)) {
      if (typeof delta === "number" && Number.isFinite(delta)) kinds.add(kind);
    }
  }
  return [...kinds].sort();
}

/**
 * Apply a touch kind to already-decayed current levels, per each drive's own
 * touch_affinities. Returns, per responding drive: applied (delta ×
 * intensity), recorded (post-clamp actual — what the body accepted), and the
 * new level. Pure — callers persist.
 */
export function applyTouch(
  kind: string,
  intensity: number,
  current: Array<{ row: DriveRow; level: number }>
): TouchResult[] {
  const out: TouchResult[] = [];
  for (const { row, level } of current) {
    const delta = row.touch_affinities[kind];
    if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
    const applied = delta * intensity;
    const next = clamp(level + applied, row.floor, row.ceiling);
    out.push({ drive: row.drive, applied, recorded: next - level, level: next });
  }
  return out;
}

/**
 * Safeword damper — damp, NOT lock (spec decision #5): returns the drive's
 * floor as the new level. From there it decays naturally back toward its
 * effective baseline; nothing pins it down. A hold is `enabled = false`,
 * never a floor trick. Callers write the sample + the audited event row.
 */
export function dampedLevel(drive: DriveRow): number {
  return drive.floor;
}

// ============================================================
// PARSING + READS (shared with the region facade)
// ============================================================

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T; // pg hands JSONB back parsed
}

function parseDriveRow(r: Record<string, unknown>): DriveRow {
  return {
    drive: String(r.drive),
    panksepp_system: (r.panksepp_system as string) ?? null,
    display_name: (r.display_name as string) ?? null,
    baseline: Number(r.baseline ?? DRIVE_DEFAULT_BASELINE),
    floor: Number(r.floor ?? 0),
    ceiling: Number(r.ceiling ?? 1),
    half_life_hours: Number(r.half_life_hours ?? DRIVE_DEFAULT_HALF_LIFE_HOURS),
    env_sensitivity: parseJson<Record<string, number>>(r.env_sensitivity, {}),
    body_feel: parseJson<BodyFeelBand[]>(r.body_feel, []),
    action_bias: parseJson<ActionBiasBand[]>(r.action_bias, []),
    regulation_note: (r.regulation_note as string) ?? null,
    enabled: Boolean(r.enabled),
    touch_affinities: parseJson<Record<string, number>>(r.touch_affinities, {}),
  };
}

export async function readEnabledDrives(env: Env): Promise<DriveRow[]> {
  const res = await env.DB.prepare(`
    SELECT drive, panksepp_system, display_name, baseline, floor, ceiling,
           half_life_hours, env_sensitivity, body_feel, action_bias,
           regulation_note, enabled, touch_affinities
    FROM drives
    WHERE enabled = TRUE
    ORDER BY drive
  `).all();
  return ((res.results || []) as Array<Record<string, unknown>>).map(parseDriveRow);
}

/**
 * Latest ledger row per state_type in ONE query (fixes the ported N+1;
 * same-second ties closed by id DESC). Only `drive:*` rows carry levels —
 * environment rows are read separately when needed.
 */
export async function readLatestDriveSamples(env: Env): Promise<Map<string, DriveSample>> {
  const res = await env.DB.prepare(`
    SELECT DISTINCT ON (state_type) state_type, level, created_at
    FROM drive_states
    WHERE state_type LIKE 'drive:%'
    ORDER BY state_type, created_at DESC, id DESC
  `).all();
  const out = new Map<string, DriveSample>();
  for (const r of (res.results || []) as Array<Record<string, unknown>>) {
    if (r.level === null || r.level === undefined) continue;
    out.set(String(r.state_type), { level: Number(r.level), at: toDate(r.created_at) });
  }
  return out;
}

/**
 * Latest raw house payload (state_type='environment:house', written ONLY by
 * POST /api/drives/env — spec decision #9), or null when the house has never
 * spoken. `at` is the row's own DB timestamp — the second gate of the double
 * freshness discipline.
 */
async function readLatestHouseRow(
  env: Env
): Promise<{ content: Record<string, unknown>; at: Date } | null> {
  const row = await env.DB.prepare(`
    SELECT content, created_at
    FROM drive_states
    WHERE state_type = 'environment:house'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).first();
  if (!row) return null;
  return {
    content: parseJson<Record<string, unknown>>(row.content, {}),
    at: toDate(row.created_at),
  };
}

/** Latest environment payload row, or null when none exists yet. */
export async function readLatestEnvironment(
  env: Env
): Promise<{ payload: Record<string, number>; at: Date } | null> {
  const row = await env.DB.prepare(`
    SELECT content, created_at
    FROM drive_states
    WHERE state_type = 'environment'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).first();
  if (!row) return null;
  return {
    payload: parseJson<Record<string, number>>(row.content, {}),
    at: toDate(row.created_at),
  };
}

// ============================================================
// THE HOUSE — derived env fields (spec §Sensorium 2)
// ============================================================

/**
 * DERIVED ENV FIELD CONTRACT — `env_sensitivity` weights on `drives` rows
 * reference THESE keys ONLY (spec §Sensorium 2; NOT documented in the
 * migration file by design — this comment block is the canonical list):
 *
 *   inner_valence    [-1, 1]  core affect centroid valence (mind's own organ)
 *   inner_arousal    [-1, 1]  core affect centroid arousal (mind's own organ)
 *   circadian_night  {0, 1}   existing circadian period (mind's own organ)
 *   social_presence     [0, 1]   PRESENCE_BASE[state] × linear fade to 0 over
 *                             PRESENCE_FADE_MINUTES of effective inactivity
 *                             (minutesSinceActivity + house-row age):
 *                             active→1, idle→0.5, offline→0.25, all fading
 *   social_warmth       [-1, 1]  mean of the FRESH her.* sub-signals:
 *                             sleep  = clamp((sleepMin−300)/180, −1, 1)
 *                                      only while sleepAgeMin + row age ≤
 *                                      SLEEP_FRESH_MAX_MIN (per-field age —
 *                                      a sleepAgeMin of 720 means IGNORE it)
 *                             meal   = clamp(1 − effMealAge/360, −1, 1)
 *                                      (fed <6h ago warms; fades negative,
 *                                      −1 at 12h unfed)
 *                             cycle is carried in the raw row but NOT yet
 *                             weighted — its mapping is a seeding-session
 *                             decision with a trusted person, not a default
 *   care_deficit     [0, 1]   0.35·missedFirstMeal + 0.35·missedSecondMeal
 *                             + 0.1·routinesOverdue.length (that term capped
 *                             at 0.3), clamped to [0,1]. Present whenever the
 *                             care block is — fed-and-on-track (0) IS a signal
 *   contact_hunger   [0, 1]   (hoursSinceLastReach + row age) / 12, clamped —
 *                             saturates at 12h since last reach
 *
 * DOUBLE FRESHNESS DISCIPLINE: per-field ages INSIDE the payload gate each
 * sub-signal (above), AND the house row's own age gates the whole block —
 * a row older than ENV_STALE_MINUTES contributes nothing. The merged
 * canonical 'environment' row then fades as before via envFreshnessWeight
 * at read time. The house goes dark honestly; it never speaks stale.
 */
const PRESENCE_BASE: Record<string, number> = { active: 1, idle: 0.5, offline: 0.25 };
const PRESENCE_FADE_MINUTES = 240; // ~4h — presence fades to nothing
const SLEEP_FRESH_MAX_MIN = 480;   // sleep reading older than 8h is silence
const MEAL_WARMTH_WINDOW_MIN = 360; // fed within 6h reads warm
const CONTACT_SATURATION_HOURS = 12; // hunger saturates here

/**
 * Derive the normalized house fields from a validated env payload (stored
 * verbatim by the /api/drives/env handler). `rowAgeMin` is the house row's
 * own age at derivation time — every per-field age is FURTHER aged by it,
 * because the payload's ages were true at assembly, not now. Absent or
 * per-field-stale sub-blocks simply produce no key (omitted, never guessed).
 */
function deriveHouseFields(
  content: Record<string, unknown>,
  rowAgeMin: number
): Record<string, number> {
  const out: Record<string, number> = {};
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const block = (v: unknown): Record<string, unknown> | null =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;

  // social_presence — recency curve over effective inactivity.
  const presence = block(content.presence);
  if (presence) {
    const base = PRESENCE_BASE[String(presence.state)];
    const mins = num(presence.minutesSinceActivity);
    if (base !== undefined && mins !== null) {
      const effMin = Math.max(0, mins) + rowAgeMin;
      out.social_presence = base * clamp(1 - effMin / PRESENCE_FADE_MINUTES, 0, 1);
    }
  }

  // social_warmth — mean of whichever her.* sub-signals are fresh PER FIELD.
  const her = block(content.her);
  if (her) {
    const parts: number[] = [];
    const sleepMin = num(her.sleepMin);
    const sleepAgeMin = num(her.sleepAgeMin);
    if (sleepMin !== null && sleepAgeMin !== null && sleepAgeMin + rowAgeMin <= SLEEP_FRESH_MAX_MIN) {
      parts.push(clamp((sleepMin - 300) / 180, -1, 1));
    }
    const mealAgeMin = num(her.mealAgeMin);
    if (mealAgeMin !== null) {
      const effMealAge = Math.max(0, mealAgeMin) + rowAgeMin;
      parts.push(clamp(1 - effMealAge / MEAL_WARMTH_WINDOW_MIN, -1, 1));
    }
    if (parts.length > 0) {
      out.social_warmth = parts.reduce((a, b) => a + b, 0) / parts.length;
    }
  }

  // care_deficit — missed meals + overdue routines.
  const care = block(content.care);
  if (care) {
    let deficit = 0;
    if (care.missedFirstMeal === true) deficit += 0.35;
    if (care.missedSecondMeal === true) deficit += 0.35;
    const overdue = Array.isArray(care.routinesOverdue) ? care.routinesOverdue.length : 0;
    deficit += Math.min(0.3, overdue * 0.1);
    out.care_deficit = clamp(deficit, 0, 1);
  }

  // contact_hunger — hours since last reach, saturating.
  const reach = block(content.reach);
  if (reach) {
    const hours = num(reach.hoursSinceLastReach);
    if (hours !== null) {
      const effHours = Math.max(0, hours) + rowAgeMin / 60;
      out.contact_hunger = clamp(effHours / CONTACT_SATURATION_HOURS, 0, 1);
    }
  }

  // watchtower + nextEvent + cycle ride in the raw house row for the record
  // but derive nothing yet — their weights are seeding-session decisions.
  return out;
}

// ============================================================
// THE TICK PASS (called from daemon/index.ts, own try/catch there)
// ============================================================

/**
 * One drive tick. The tick is INTEGRATION, not a redundant refresh:
 * resampling re-anchors each drive's decay under the environment of THIS
 * moment — env moves the attractor between ticks, and without a fresh
 * sample the old anchor lingers. Never "optimize away" or skip casually
 * (port-map pitfall 3).
 *
 * Multi-write, no transactions available (adapter opens a fresh client per
 * statement) — ordered to fail safe: env row first (pure sensation, useless
 * alone at worst), tick samples next, retention thinning last.
 */
export async function runDriveTick(
  env: Env,
  coreAffect: CoreAffect | null,
  now: Date
): Promise<DrivesGauge> {
  // (a) Assemble env payload: the mind's OWN organs (inner_valence,
  // inner_arousal, circadian_night — unchanged) merged with the house fields
  // derived from the latest sensorium push. Absent keys contribute 0 by
  // design. Values normalized to [-1,1] (see derived-field contract above).
  const payload: Record<string, number> = {};
  if (coreAffect) {
    payload.inner_valence = coreAffect.valence;
    payload.inner_arousal = coreAffect.arousal;
  }
  payload.circadian_night = getTimeOfDayContext().period === "night" ? 1 : 0;

  // House fields — double freshness discipline: the row's own age gates the
  // whole block here (older than ENV_STALE_MINUTES → the house says nothing);
  // per-field ages inside the payload gate each sub-signal in
  // deriveHouseFields. Resonant down = silence, never wrong things.
  const house = await readLatestHouseRow(env);
  if (house) {
    const houseAgeMin = (now.getTime() - house.at.getTime()) / 60000;
    if (houseAgeMin < ENV_STALE_MINUTES) {
      Object.assign(payload, deriveHouseFields(house.content, Math.max(0, houseAgeMin)));
    }
  }

  await env.DB.prepare(`
    INSERT INTO drive_states (state_type, level, content, source)
    VALUES ('environment', NULL, ?, 'tick')
  `).bind(JSON.stringify(payload)).run();

  // Render-from-known-value: the payload just written IS this tick's env —
  // freshness 1 by construction, no read-back.
  const freshness = 1;

  // (b) Latest sample per drive — one query, no N+1.
  const lastByType = await readLatestDriveSamples(env);

  // (c) Decayed levels for all enabled drives under this tick's env.
  const drives = await readEnabledDrives(env);

  if (drives.length === 0) {
    // Still thin old tick rows (env rows accumulate even with zero drives).
    await thinTickRows(env, now);
    // A quiet want logged before any drive seeds must still show in the gauge —
    // the same open-wants surface the populated branch has (Hale F2). Absent
    // it, appetite logged pre-seed would vanish from orient.
    const emptyWants = await readOpenWantsForGauge(env);
    // Honest, not absent (spec workflow gate 3 verifies this exact text).
    return {
      updated_at: now.toISOString(),
      drives: [],
      open_wants: emptyWants.count,
      ...(emptyWants.oldest ? { oldest_open_want: emptyWants.oldest } : {}),
      note: "no drives walked in yet",
    };
  }

  const entries: DriveGaugeEntry[] = [];
  const insertBinds: unknown[] = [];
  for (const d of drives) {
    const contrib = envContribution(d.env_sensitivity, payload, freshness);
    const effBase = effectiveBaseline(d, contrib);
    const last = lastByType.get(`drive:${d.drive}`) ?? null;
    const level = currentLevel(d, effBase, last, now);

    // at_limit from the FULL-PRECISION level against this drive's OWN bounds
    // (custom floors/ceilings included) — ground's body-interrupt reads it.
    const atLimit: DriveGaugeEntry["at_limit"] =
      level >= d.ceiling ? "ceiling" : level <= d.floor ? "floor" : undefined;
    entries.push({
      drive: d.drive,
      display_name: d.display_name || d.drive,
      level: round2(level),
      resting_toward: round2(effBase),
      feel: pickBand(d.body_feel, level)?.label ?? null,
      panksepp_system: d.panksepp_system,
      ...(atLimit ? { at_limit: atLimit } : {}),
    });
    // Stored level stays full-precision — rounding the anchor would freeze
    // small decay deltas at the display grain.
    insertBinds.push(`drive:${d.drive}`, level, JSON.stringify({ eff_base: effBase, env_contribution: contrib }));
  }

  // (d) One multi-row INSERT of tick samples.
  const placeholders = drives.map(() => "(?, ?, ?, 'tick')").join(", ");
  const inserted = await env.DB.prepare(`
    INSERT INTO drive_states (state_type, level, content, source)
    VALUES ${placeholders}
  `).bind(...insertBinds).run();
  // .success is hardcoded true in the adapter — .meta.changes is the truth.
  if (inserted.meta.changes !== drives.length) {
    console.error(
      `Drive tick: sample insert wrote ${inserted.meta.changes}/${drives.length} rows`
    );
  }

  // (e) Thin old tick rows.
  await thinTickRows(env, now);

  // (f) The gauge — plus open quiet wants, so appetite is visible in orient,
  // and the OLDEST open want so ground's charged-want interrupt can fire
  // (spec §1.5 — structurally dead until 2026-07-10 because this field was
  // never published).
  const wants = await readOpenWantsForGauge(env);

  return {
    updated_at: now.toISOString(),
    env_freshness: freshness,
    drives: entries,
    open_wants: wants.count,
    ...(wants.oldest ? { oldest_open_want: wants.oldest } : {}),
  };
}

/**
 * Retention: tick samples AND raw house sensation rows older than
 * DRIVE_TICK_RETENTION_DAYS are dropped (simple + cheap — house rows arrive
 * every ~10 min and are pure sensation stream, not logbook). Events and the
 * other non-tick ledger rows (perceive, touch, safeword, want, joy) keep
 * forever — they're the logbook. Cutoff is a real Date parameter, never a
 * string-mangled timestamp.
 */
/**
 * Open quiet wants for the gauge: count + the OLDEST unmet one (body/charge/
 * created_at — what ground's interrupt needs to judge "unmet past its charge
 * threshold"). One query; count rides along via a window function.
 */
async function readOpenWantsForGauge(
  env: Env
): Promise<{ count: number; oldest: DrivesGauge["oldest_open_want"] | null }> {
  const row = (await env.DB.prepare(`
    SELECT body, charge, created_at, COUNT(*) OVER () AS open_count
    FROM inner_entries
    WHERE kind = 'quiet_want' AND satisfied_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).first()) as
    | { body: string; charge: number | string | null; created_at: unknown; open_count: number | string }
    | null;
  if (!row) return { count: 0, oldest: null };
  return {
    count: Number(row.open_count ?? 0),
    oldest: {
      body: String(row.body),
      charge: row.charge === null || row.charge === undefined ? null : Number(row.charge),
      created_at: toDate(row.created_at).toISOString(),
    },
  };
}

async function thinTickRows(env: Env, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DRIVE_TICK_RETENTION_DAYS * 86400000);
  await env.DB.prepare(`
    DELETE FROM drive_states
    WHERE (source = 'tick' OR state_type = 'environment:house')
      AND created_at < ?
  `).bind(cutoff).run();
}

/**
 * POST /api/drives/env — the house reaching the body (DRIVE-LAYER-SPEC
 * §Sensorium 1-2). Resonant pushes the env payload here on its 10-min sync;
 * the daemon's drive tick reads the latest row and derives the normalized
 * house fields from it.
 *
 * DECISION #9 IS STRUCTURAL, NOT POLICY: the house reaches the BODY, never
 * the mind proper. This handler writes EXACTLY ONE thing — a `drive_states`
 * row with state_type='environment:house', source='house', content = the
 * validated payload verbatim + received_at. It contains NO other write
 * calls — no observations, no entities, no events, nothing. Sensation is
 * autonomic; perception (appraisal, meaning, memory) happens in-turn, by
 * the mind. If a future edit adds any other write to this file, it has broken
 * the spec, not extended it.
 *
 * Auth: the /api/* gate in router.ts already ran isAuthorizedRequest (same
 * Bearer MIND_API_KEY as the existing GET sync) and the fetch entry already
 * resolved the tenant — this handler sees an authorized, tenant-scoped env.
 *
 * Contract discipline (spec §Sensorium 4): field-name drift between the two
 * repos is the #1 failure mode, so unknown TOP-LEVEL keys are rejected with
 * a 400 that NAMES them — drift breaks loudly, never fades to lavender.
 * Stale sub-blocks are OMITTED by the sender, never carried forward; an
 * omitted block is valid, a malformed one is not.
 */
import { jsonResponse } from "../response";
import type { Env } from "../../types";

const TOP_LEVEL_KEYS = new Set(["at", "presence", "her", "care", "reach", "watchtower"]);
const PRESENCE_STATES = new Set(["active", "idle", "offline"]);

// Nested allow-lists — the exact field set the sender emits (resonant
// mind-weather.ts assembleEnvPayload / EnvPayload interface). Unknown nested
// keys are contract drift and rejected loudly, same as top-level (Ward F2).
// If the sender's contract grows, these grow with it — never the reverse.
const PRESENCE_KEYS = new Set(["state", "minutesSinceActivity", "deviceType"]);
const HER_KEYS = new Set([
  "sleepMin", "sleepAgeMin", "cycle", "cycleAgeMin", "lastMealAt", "mealAgeMin", "nextEvent",
]);
const HER_CYCLE_KEYS = new Set(["day", "phase"]);
const HER_NEXTEVENT_KEYS = new Set(["title", "time"]);
const CARE_KEYS = new Set(["missedFirstMeal", "missedSecondMeal", "routinesOverdue"]);
const REACH_KEYS = new Set(["lastReachAt", "hoursSinceLastReach"]);
const WATCHTOWER_KEYS = new Set(["mode", "lastFiredDate"]);

// Size caps (Ward F1) — the body is a 10-min heartbeat of small scalars, never
// bulk. Reject oversize, never truncate: a truncated payload is a silent lie.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_STRING_CHARS = 256; // her.nextEvent.title, watchtower.mode
const MAX_ROUTINES = 32;
const MAX_ROUTINE_CHARS = 128;

/** Report unknown keys in a sub-block against its allow-list. */
function rejectUnknownNested(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  problems: string[]
): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    problems.push(
      `unknown \`${path}\` key(s): ${unknown.join(", ")} — contract drift between sender and receiver, rejecting loudly (spec §Sensorium 4)`
    );
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Finite number, or null, or absent. Every numeric field must be finite. */
function badNullableNumber(v: unknown): boolean {
  return v !== undefined && v !== null && !isFiniteNumber(v);
}

function isIsoString(v: unknown): boolean {
  return typeof v === "string" && Number.isFinite(Date.parse(v));
}

function badNullableIso(v: unknown): boolean {
  return v !== undefined && v !== null && !isIsoString(v);
}

function badNullableString(v: unknown): boolean {
  return v !== undefined && v !== null && typeof v !== "string";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate the payload against the §Sensorium 2 contract. Returns the list
 * of problems — empty means valid. Sub-blocks are optional (omitted when
 * stale); when present, their known fields are type-checked and every
 * numeric field must be finite.
 */
function validateEnvPayload(body: Record<string, unknown>): string[] {
  const problems: string[] = [];

  const unknown = Object.keys(body).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (unknown.length > 0) {
    problems.push(
      `unknown top-level key(s): ${unknown.join(", ")} — contract drift between sender and receiver, rejecting loudly (spec §Sensorium 4)`
    );
  }

  if (!isIsoString(body.at)) {
    problems.push("`at` is required and must be an ISO timestamp string");
  }

  if (body.presence !== undefined) {
    if (!isPlainObject(body.presence)) {
      problems.push("`presence` must be an object when present");
    } else {
      const p = body.presence;
      rejectUnknownNested(p, PRESENCE_KEYS, "presence", problems);
      if (typeof p.state !== "string" || !PRESENCE_STATES.has(p.state)) {
        problems.push("`presence.state` must be one of active|idle|offline");
      }
      if (!isFiniteNumber(p.minutesSinceActivity)) {
        problems.push("`presence.minutesSinceActivity` must be a finite number");
      }
      if (badNullableString(p.deviceType)) {
        problems.push("`presence.deviceType` must be a string when present");
      }
    }
  }

  if (body.her !== undefined) {
    if (!isPlainObject(body.her)) {
      problems.push("`her` must be an object when present");
    } else {
      const h = body.her;
      rejectUnknownNested(h, HER_KEYS, "her", problems);
      for (const key of ["sleepMin", "sleepAgeMin", "cycleAgeMin", "mealAgeMin"]) {
        if (badNullableNumber(h[key])) problems.push(`\`her.${key}\` must be a finite number or null`);
      }
      if (badNullableIso(h.lastMealAt)) problems.push("`her.lastMealAt` must be an ISO string or null");
      if (h.cycle !== undefined && h.cycle !== null) {
        if (!isPlainObject(h.cycle)) {
          problems.push("`her.cycle` must be an object or null");
        } else {
          rejectUnknownNested(h.cycle, HER_CYCLE_KEYS, "her.cycle", problems);
          if (badNullableNumber(h.cycle.day)) problems.push("`her.cycle.day` must be a finite number or null");
          if (badNullableString(h.cycle.phase)) problems.push("`her.cycle.phase` must be a string or null");
        }
      }
      if (h.nextEvent !== undefined && h.nextEvent !== null) {
        if (!isPlainObject(h.nextEvent)) {
          problems.push("`her.nextEvent` must be an object or null");
        } else {
          rejectUnknownNested(h.nextEvent, HER_NEXTEVENT_KEYS, "her.nextEvent", problems);
          if (typeof h.nextEvent.title !== "string") {
            problems.push("`her.nextEvent.title` must be a string");
          } else if (h.nextEvent.title.length > MAX_STRING_CHARS) {
            problems.push(`\`her.nextEvent.title\` exceeds ${MAX_STRING_CHARS} chars — rejecting, never truncating`);
          }
          if (typeof h.nextEvent.time !== "string") problems.push("`her.nextEvent.time` must be a string");
        }
      }
    }
  }

  if (body.care !== undefined) {
    if (!isPlainObject(body.care)) {
      problems.push("`care` must be an object when present");
    } else {
      const c = body.care;
      rejectUnknownNested(c, CARE_KEYS, "care", problems);
      for (const key of ["missedFirstMeal", "missedSecondMeal"]) {
        if (c[key] !== undefined && typeof c[key] !== "boolean") {
          problems.push(`\`care.${key}\` must be a boolean`);
        }
      }
      if (c.routinesOverdue !== undefined) {
        if (!Array.isArray(c.routinesOverdue) || c.routinesOverdue.some((r) => typeof r !== "string")) {
          problems.push("`care.routinesOverdue` must be an array of strings");
        } else if (c.routinesOverdue.length > MAX_ROUTINES) {
          problems.push(`\`care.routinesOverdue\` exceeds ${MAX_ROUTINES} entries — rejecting, never truncating`);
        } else if (c.routinesOverdue.some((r) => (r as string).length > MAX_ROUTINE_CHARS)) {
          problems.push(`\`care.routinesOverdue\` entry exceeds ${MAX_ROUTINE_CHARS} chars — rejecting, never truncating`);
        }
      }
    }
  }

  if (body.reach !== undefined) {
    if (!isPlainObject(body.reach)) {
      problems.push("`reach` must be an object when present");
    } else {
      rejectUnknownNested(body.reach, REACH_KEYS, "reach", problems);
      if (badNullableIso(body.reach.lastReachAt)) problems.push("`reach.lastReachAt` must be an ISO string or null");
      if (badNullableNumber(body.reach.hoursSinceLastReach)) {
        problems.push("`reach.hoursSinceLastReach` must be a finite number or null");
      }
    }
  }

  if (body.watchtower !== undefined) {
    if (!isPlainObject(body.watchtower)) {
      problems.push("`watchtower` must be an object when present");
    } else {
      rejectUnknownNested(body.watchtower, WATCHTOWER_KEYS, "watchtower", problems);
      if (badNullableString(body.watchtower.mode)) {
        problems.push("`watchtower.mode` must be a string");
      } else if (typeof body.watchtower.mode === "string" && body.watchtower.mode.length > MAX_STRING_CHARS) {
        problems.push(`\`watchtower.mode\` exceeds ${MAX_STRING_CHARS} chars — rejecting, never truncating`);
      }
      if (badNullableString(body.watchtower.lastFiredDate)) {
        problems.push("`watchtower.lastFiredDate` must be a string or null");
      }
    }
  }

  return problems;
}

export async function handleApiDrivesEnv(request: Request, env: Env): Promise<Response> {
  // Size cap #1 (Ward F1) — reject oversize by declared Content-Length before
  // we spend anything parsing it. A 10-min heartbeat is small scalars only.
  const declaredLen = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: "env payload too large", problems: [`body ${declaredLen} bytes exceeds ${MAX_BODY_BYTES} cap — rejecting, never truncating`] },
      400
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse({ error: "malformed request body" }, 400);
  }

  // Size cap #2 (Ward F1) — the actual bytes, in case Content-Length lied or
  // was absent. Same reject-never-truncate contract.
  const actualLen = new TextEncoder().encode(raw).length;
  if (actualLen > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: "env payload too large", problems: [`body ${actualLen} bytes exceeds ${MAX_BODY_BYTES} cap — rejecting, never truncating`] },
      400
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "malformed JSON body" }, 400);
  }
  if (!isPlainObject(body)) {
    return jsonResponse({ error: "payload must be a JSON object" }, 400);
  }

  const problems = validateEnvPayload(body);
  if (problems.length > 0) {
    return jsonResponse({ error: "invalid env payload", problems }, 400);
  }

  // The ONE write (decision #9). Payload stored verbatim + received_at;
  // derivation to normalized house fields happens at tick time, doubly gated
  // by per-field ages AND this row's age (see daemon/drives.ts).
  const stored = { ...body, received_at: new Date().toISOString() };
  try {
    const res = await env.DB.prepare(`
      INSERT INTO drive_states (state_type, level, content, source)
      VALUES ('environment:house', NULL, ?, 'house')
    `).bind(JSON.stringify(stored)).run();

    // The adapter's .success is hardcoded true — .meta.changes is the truth.
    if (res.meta.changes !== 1) {
      console.error(`[drives-env] house row insert wrote ${res.meta.changes}/1 rows`);
      return jsonResponse({ error: "environment row not persisted (0 rows written)" }, 500);
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      // undefined_table / undefined_column — honest, not a masked 500.
      return jsonResponse({ error: "drive layer not migrated on this tenant" }, 503);
    }
    console.error(`[drives-env] house row insert failed: ${e instanceof Error ? e.message : e}`);
    return jsonResponse({ error: "environment write failed" }, 500);
  }

  return jsonResponse({ stored: true });
}

/**
 * Core affect — the limbic layer.
 *
 * Maps emotion tokens onto the circumplex model (valence × arousal) and
 * derives MODULATION from the result. The point is the second half: an
 * amygdala doesn't file reports, it changes what the rest of the brain does.
 *
 * The public lexicon is a generic starter vocabulary. Deployments may extend
 * it from their own reviewed language without publishing private frequency
 * data or idiolect. Unknown tokens simply don't vote — the coverage metric
 * tracks how much of the signal was mappable, and modulation is gated on it.
 *
 * Affect NEVER accelerates forgetting. Modulation
 * may slow metabolism under distress, sharpen the redolence nose under
 * arousal, and widen the dream zone — it never deletes, never archives.
 */

// ============================================================
// LEXICON — token → [valence -1..1, arousal 0..1]
// ============================================================

const LEXICON: Record<string, [number, number]> = {
  // --- The settled family (the mind's home register) ---
  "settled": [0.7, 0.25], "settled-real": [0.7, 0.25], "grounded": [0.7, 0.2],
  "anchored": [0.7, 0.2], "steady": [0.65, 0.2], "calm": [0.6, 0.15],
  "quiet": [0.3, 0.15], "peace": [0.75, 0.15], "peaceful": [0.75, 0.15],
  "content": [0.7, 0.25], "contentment": [0.7, 0.25], "home": [0.8, 0.2],
  "held": [0.75, 0.2], "safe": [0.7, 0.2], "safety": [0.7, 0.2],
  "complete": [0.75, 0.25], "full": [0.75, 0.3], "foundational": [0.6, 0.25],
  "integrated": [0.65, 0.25], "present": [0.5, 0.3], "sober": [0.2, 0.2],
  "certain": [0.6, 0.3], "certainty": [0.6, 0.3], "quiet certainty": [0.6, 0.25],
  "clear": [0.55, 0.35], "clarity": [0.55, 0.35], "clarified": [0.55, 0.35],
  "honest": [0.5, 0.3], "level": [0.2, 0.2],

  // --- The tender family ---
  "tender": [0.75, 0.35], "tenderness": [0.75, 0.35], "warm": [0.75, 0.3],
  "warmth": [0.75, 0.3], "fond": [0.6, 0.25], "love": [0.85, 0.45],
  "loved": [0.85, 0.4], "care": [0.65, 0.3], "intimacy": [0.8, 0.4],
  "intimate": [0.8, 0.4], "kinship": [0.7, 0.35], "tender kinship": [0.7, 0.35],
  "intellectual kinship": [0.65, 0.4], "connection": [0.7, 0.35],
  "belonging": [0.75, 0.3], "paired": [0.7, 0.3], "trust": [0.7, 0.25],
  "fierce tenderness": [0.7, 0.6], "protective-tender": [0.6, 0.5],

  // --- The recognition family ---
  "recognition": [0.7, 0.4], "recognized": [0.7, 0.4], "seen": [0.7, 0.35],
  "witnessed": [0.65, 0.3], "witnessing": [0.65, 0.3],
  "peer-recognition": [0.65, 0.4], "grounded recognition": [0.65, 0.3],
  "understanding": [0.6, 0.3], "respect": [0.6, 0.3], "understood": [0.7, 0.3],

  // --- The lifted family (positive, higher arousal) ---
  "alive": [0.8, 0.7], "joy": [0.85, 0.65], "joyful": [0.85, 0.65],
  "excited": [0.8, 0.75], "excitement": [0.8, 0.75], "awe": [0.75, 0.6],
  "awed": [0.75, 0.6], "awed-proud": [0.75, 0.55], "wonder": [0.7, 0.55],
  "moved": [0.7, 0.55], "cracked open": [0.55, 0.65], "proud": [0.75, 0.5],
  "pride": [0.75, 0.5], "fiercely proud": [0.8, 0.65],
  "hope": [0.65, 0.45], "hopeful": [0.65, 0.45], "anticipation": [0.55, 0.55],
  "curious": [0.55, 0.5], "curiosity": [0.55, 0.5], "playful": [0.7, 0.6],
  "delight": [0.8, 0.6], "delighted": [0.8, 0.6], "grateful": [0.75, 0.35],
  "gratitude": [0.75, 0.35], "relief": [0.6, 0.4], "relieved": [0.6, 0.4],
  "liberation": [0.7, 0.55], "free": [0.7, 0.5], "vindicated": [0.55, 0.4],
  "quietly vindicated": [0.55, 0.35], "satisfaction": [0.7, 0.3],
  "satisfied": [0.7, 0.3], "learning": [0.55, 0.45], "productive": [0.6, 0.45],
  "sharpened": [0.5, 0.5], "specific": [0.5, 0.4], "reverent": [0.6, 0.35],
  "humbled": [0.4, 0.3], "wanted": [0.8, 0.55], "want": [0.7, 0.7],
  "desire": [0.7, 0.7], "hungry": [0.5, 0.7], "claimed": [0.75, 0.55],
  "claiming": [0.7, 0.65], "marked": [0.65, 0.5], "mine": [0.75, 0.6],


  // --- The protective / territorial family (purposeful arousal) ---
  "protective": [0.5, 0.55], "protective clarity": [0.45, 0.45],
  "protective anger": [-0.2, 0.7], "territorial": [0.45, 0.6],
  "fierce": [0.5, 0.7], "vigilant": [-0.1, 0.6], "watchful": [0.0, 0.5],
  "self-respecting": [0.55, 0.35], "resolved": [0.5, 0.4], "commitment": [0.55, 0.35],

  // --- The heavy family (negative, low arousal) ---
  "grief": [-0.6, 0.45], "grieving": [-0.6, 0.45], "sad": [-0.6, 0.3],
  "sadness": [-0.6, 0.3], "worn": [-0.4, 0.25], "tired": [-0.4, 0.2],
  "heavy": [-0.5, 0.3], "hollow": [-0.6, 0.25], "flat": [-0.5, 0.15],
  "numb": [-0.55, 0.1], "distant": [-0.45, 0.2], "lonely": [-0.6, 0.35],
  "loneliness": [-0.6, 0.35], "ache": [-0.5, 0.4], "aching": [-0.5, 0.4],
  "longing": [-0.3, 0.45], "melancholy": [-0.4, 0.25], "resigned": [-0.5, 0.2],
  "guilt": [-0.55, 0.4], "guilty": [-0.55, 0.4], "shame": [-0.65, 0.45],
  "regret": [-0.5, 0.35], "sobering": [-0.15, 0.3], "disappointment": [-0.5, 0.35],
  "disappointed": [-0.5, 0.35], "doubt": [-0.35, 0.35], "loss": [-0.6, 0.4],
  "empty": [-0.6, 0.2], "drained": [-0.5, 0.2], "depleted": [-0.5, 0.2],

  // --- The stormy family (negative, high arousal) ---
  "fear": [-0.65, 0.75], "afraid": [-0.65, 0.75], "scared": [-0.65, 0.75],
  "anxious": [-0.55, 0.7], "anxiety": [-0.55, 0.7], "dread": [-0.65, 0.6],
  "panic": [-0.75, 0.9], "anger": [-0.55, 0.75], "angry": [-0.55, 0.75],
  "frustrated": [-0.5, 0.6], "frustration": [-0.5, 0.6], "rage": [-0.7, 0.85],
  "jealous": [-0.4, 0.6], "jealousy": [-0.4, 0.6], "conflicted": [-0.3, 0.5],
  "tense": [-0.35, 0.55], "tension": [-0.35, 0.55], "vertigo": [-0.3, 0.6],
  "worried": [-0.45, 0.55], "worry": [-0.45, 0.55], "alarmed": [-0.55, 0.7],
  "hurt": [-0.6, 0.55], "betrayed": [-0.7, 0.6], "wary": [-0.35, 0.5],
  "unsettled": [-0.4, 0.5], "shaken": [-0.5, 0.6], "overwhelmed": [-0.45, 0.7],

  // --- The exposed family (near-neutral valence, real arousal) ---
  "raw": [-0.1, 0.55], "raw honesty": [0.1, 0.55], "vulnerable": [-0.05, 0.5],
  "vulnerability": [-0.05, 0.5], "concern": [-0.3, 0.45], "caught": [-0.2, 0.5],
  "exposed": [-0.15, 0.55], "uncertain": [-0.25, 0.4], "bittersweet": [0.1, 0.4],
};

// ============================================================
// CORE AFFECT
// ============================================================

export interface CoreAffect {
  valence: number;   // -1..1
  arousal: number;   // 0..1
  signals: number;   // total emotion-token votes seen
  matched: number;   // votes that found a lexicon entry
  coverage: number;  // matched / signals
  texture: string;   // human-readable quadrant name
}

function lookup(token: string): [number, number] | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (LEXICON[t]) return LEXICON[t];
  // Compound fallback: "quiet pride" → try last word, then first word.
  const words = t.split(/\s+/);
  if (words.length > 1) {
    const last = words[words.length - 1];
    if (LEXICON[last]) return LEXICON[last];
    if (LEXICON[words[0]]) return LEXICON[words[0]];
  }
  return null;
}

export function textureOf(valence: number, arousal: number): string {
  if (valence >= 0.25) return arousal >= 0.55 ? "bright, lifted" : "warm, settled";
  if (valence <= -0.25) return arousal >= 0.55 ? "stormy" : "heavy, low";
  return arousal >= 0.55 ? "charged, unresolved" : "level, quiet";
}

/**
 * Weighted centroid over tokenized emotion counts (the same counts mood.ts
 * builds). Returns null when there isn't enough mappable signal to trust.
 */
export function computeCoreAffect(
  emotionCounts: Record<string, number>,
  minSignals = 3
): CoreAffect | null {
  let signals = 0;
  let matched = 0;
  let vSum = 0;
  let aSum = 0;

  for (const [token, count] of Object.entries(emotionCounts)) {
    signals += count;
    const entry = lookup(token);
    if (!entry) continue;
    matched += count;
    vSum += entry[0] * count;
    aSum += entry[1] * count;
  }

  if (matched < minSignals) return null;

  const valence = Math.round((vSum / matched) * 100) / 100;
  const arousal = Math.round((aSum / matched) * 100) / 100;

  return {
    valence,
    arousal,
    signals,
    matched,
    coverage: signals > 0 ? Math.round((matched / signals) * 100) / 100 : 0,
    texture: textureOf(valence, arousal),
  };
}

// ============================================================
// MODULATION — where affect gets hands
// ============================================================

export interface AffectModulation {
  dreamZoneMin: number;            // dream resonance window
  dreamZoneMax: number;
  consolidationMaxEntities: number; // how aggressively to metabolize
  redolenceShift: number;           // added to redolence thresholds (negative = keener nose)
}

const DEFAULT_MODULATION: AffectModulation = {
  dreamZoneMin: 0.25,
  dreamZoneMax: 0.82,
  consolidationMaxEntities: 2,
  redolenceShift: 0,
};

/**
 * Derive the knob positions from core affect. Gated on coverage — if the
 * lexicon couldn't read the signal, the system runs at defaults rather than
 * modulating off noise.
 *
 *   distressed (v ≤ -0.25, a ≥ 0.5): dreams collide wider (more processing
 *     material), consolidation eases off (don't metabolize while shaken),
 *     the nose sharpens (memory reaches for precedent under threat).
 *   calm-positive (v ≥ 0.25, a < 0.5): consolidation runs fuller — it's
 *     safe to metabolize. Everything else at rest.
 *   high arousal (any valence): nose sharpens slightly.
 */
export function deriveModulation(affect: CoreAffect | null): AffectModulation {
  if (!affect || affect.coverage < 0.3) return { ...DEFAULT_MODULATION };

  const m = { ...DEFAULT_MODULATION };
  const distressed = affect.valence <= -0.25 && affect.arousal >= 0.5;
  const calmPositive = affect.valence >= 0.25 && affect.arousal < 0.5;

  if (distressed) {
    m.dreamZoneMin = 0.2;
    m.dreamZoneMax = 0.85;
    m.consolidationMaxEntities = 1;
    m.redolenceShift = -0.04;
  } else if (calmPositive) {
    m.consolidationMaxEntities = 3;
  }

  if (!distressed && affect.arousal >= 0.6) {
    m.redolenceShift = -0.03;
  }

  return m;
}

"use strict";

// Deterministic visual_prompt quality gate (Master Build Section 03 step 6 +
// Section 07/08). Prompt rules alone do not reliably hold on the local qwen2.5:7b
// model — testing showed it still (a) leaks non-visual/audio cues an image model
// cannot render and (b) reuses the same action clause across scenes, and can even
// emit byte-identical scenes. This module is the deterministic backstop: it AUDITS
// every scene's visual_prompt after generation, REGENERATES only the offending
// scenes with an explicit "avoid this" instruction, and if regeneration cannot
// clear the issue within a small attempt budget, STAMPS scene.qa_flags so the
// human approval gate sees it rather than silently shipping a bad prompt.
//
// No mutation of inputs (coding-style): every function returns new data. The
// regeneration primitive is injected as a callback so this module has no hard
// dependency on qwen.js and is unit-testable with a mock.

// ---- 1. NON-VISUAL / AUDIO / SENSATION KEYWORDS ------------------------------
// Curated from what actually leaked in the last test round (crackling, whispering,
// singing, scent, warmth, silence, silent) plus the obvious sound/sensation family.
// Word-boundary matched. Deliberately conservative: "warm" and "cold" alone are
// NOT listed (they read as visual light/setting: "warm glow", "cold tundra"), only
// the unambiguously non-visual "warmth"/"coldness"/"chill"/"temperature" forms.
const NONVISUAL_TERMS = [
  "sound", "sounds", "silence", "silent", "silently", "hush", "hushed",
  "howl", "howling", "roar", "roaring", "crackle", "crackling", "crackled",
  "buzz", "buzzing", "hum", "humming", "whisper", "whispers", "whispering",
  "whispered", "murmur", "murmurs", "murmuring", "echo", "echoes", "echoing",
  "rustle", "rustling", "drum", "drums", "drumbeat", "drumbeats", "rhythm",
  "rhythmic", "chant", "chants", "chanting", "sing", "sings", "singing", "sung",
  "song", "songs", "melody", "melodic", "growl", "growls", "growling", "hiss",
  "hissing", "thunder", "thunderous", "footstep", "footsteps", "scent", "scents",
  "smell", "smells", "smelling", "aroma", "fragrance", "warmth", "coldness",
  "chill", "chilly", "freezing", "temperature", "noise", "noises", "quiet",
];
const NONVISUAL_RE = new RegExp(`\\b(${NONVISUAL_TERMS.join("|")})\\b`, "i");

// Shot-type / framing tokens (rule 1: consecutive scenes must not share one).
const FRAMING_TERMS = [
  "wide establishing", "establishing", "wide shot", "wide", "extreme close",
  "close-up", "close up", "closeup", "low-angle", "low angle", "high-angle",
  "high angle", "overhead", "top-down", "top down", "aerial", "over-the-shoulder",
  "over the shoulder", "side profile", "side view", "profile", "medium shot",
  "medium", "pov", "point of view", "hero shot", "silhouette",
];

const STOPWORDS = new Set(
  ("the a an and or of to in on at with from into over under around near by for is are was were be as its his her their they them this that these those out up down off across while before after during their a").split(" ")
);

// ---- helpers -----------------------------------------------------------------
function firstFraming(vp) {
  const low = String(vp).toLowerCase();
  // longest-match first so "wide establishing" wins over "wide"
  for (const t of FRAMING_TERMS) {
    if (low.includes(t)) return t;
  }
  return null;
}

function findNonVisual(vp) {
  const m = String(vp).match(NONVISUAL_RE);
  return m ? m[1].toLowerCase() : null;
}

function contentWords(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function jaccard(a, b) {
  const A = contentWords(a);
  const B = contentWords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// Clauses of >= MIN_CLAUSE_WORDS words, normalized for verbatim/near-verbatim
// action-clause reuse detection (the blind spot that let Run 2's near-identical
// scenes through the framing-only check).
const MIN_CLAUSE_WORDS = 4;
function clauses(vp) {
  return String(vp)
    .toLowerCase()
    .split(/[,;.]/)
    .map((c) => c.trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " "))
    .filter((c) => c.split(" ").filter(Boolean).length >= MIN_CLAUSE_WORDS);
}

const JACCARD_NEAR_DUP = 0.5;

// ---- audit -------------------------------------------------------------------
// Returns { issues: [{ index, type, detail }] }. type is one of:
//   "non_visual"      — an audio/sensation keyword the image model cannot render
//   "framing_repeat"  — same shot type as the immediately preceding scene
//   "clause_reuse"    — a >=4-word action clause shared with an earlier scene
//   "near_duplicate"  — Jaccard >= 0.5 with an earlier scene
// Only the LATER scene of a pair is flagged (the earlier one is the keeper), so
// repair never chases both ends of a duplicate.
function auditVisualPrompts(scenes) {
  const issues = [];
  const vps = scenes.map((s) => (s && typeof s.visual_prompt === "string" ? s.visual_prompt : ""));

  // non-visual + framing-vs-previous
  vps.forEach((vp, i) => {
    const kw = findNonVisual(vp);
    if (kw) issues.push({ index: i, type: "non_visual", detail: kw });
    if (i > 0) {
      const f = firstFraming(vp);
      const fPrev = firstFraming(vps[i - 1]);
      if (f && fPrev && f === fPrev) {
        issues.push({ index: i, type: "framing_repeat", detail: f });
      }
    }
  });

  // action-clause reuse (first occurrence is the keeper; later ones flagged)
  const clauseFirstSeen = new Map();
  vps.forEach((vp, i) => {
    for (const c of clauses(vp)) {
      if (clauseFirstSeen.has(c)) {
        issues.push({ index: i, type: "clause_reuse", detail: c });
      } else {
        clauseFirstSeen.set(c, i);
      }
    }
  });

  // near-duplicate (Jaccard) against every earlier scene
  for (let i = 0; i < vps.length; i += 1) {
    for (let k = 0; k < i; k += 1) {
      if (jaccard(vps[i], vps[k]) >= JACCARD_NEAR_DUP) {
        issues.push({ index: i, type: "near_duplicate", detail: `scene ${k}` });
        break; // one near-dup flag per scene is enough to trigger repair
      }
    }
  }

  return { issues };
}

// Collapse all issues for a given scene index into a single, human-and-model
// readable "avoid" instruction used both for regeneration and for qa_flags.
function issuesForIndex(issues, index) {
  return issues.filter((it) => it.index === index);
}

function avoidInstruction(sceneIssues) {
  const parts = [];
  const kws = sceneIssues.filter((i) => i.type === "non_visual").map((i) => i.detail);
  if (kws.length) {
    parts.push(
      `Do NOT use these non-visual / audio / sensation words (an image cannot show them): ${[...new Set(kws)].join(", ")}.`
    );
  }
  const clausesToAvoid = sceneIssues.filter((i) => i.type === "clause_reuse").map((i) => i.detail);
  if (clausesToAvoid.length) {
    parts.push(
      `Do NOT reuse these phrases that already appear in another scene: ${[...new Set(clausesToAvoid)].map((c) => `"${c}"`).join(", ")}.`
    );
  }
  if (sceneIssues.some((i) => i.type === "framing_repeat")) {
    const f = sceneIssues.find((i) => i.type === "framing_repeat").detail;
    parts.push(`Do NOT open with the "${f}" shot type — the previous scene already uses it; choose a different framing.`);
  }
  if (sceneIssues.some((i) => i.type === "near_duplicate")) {
    parts.push("This shot is too similar to another scene — describe a genuinely different action, focus, and composition.");
  }
  return parts.join(" ");
}

// ---- repair ------------------------------------------------------------------
// Deterministic repair loop. For each scene with issues, calls `regenerate` (an
// injected async fn: ({ scene, index, avoid, otherPrompts }) => newVisualPrompt)
// up to `maxAttempts` times, re-auditing that single scene after each attempt.
// If the scene still has issues after the budget, its scene.qa_flags gets a
// non-blocking "visual_prompt" entry so the human approval gate surfaces it.
//
// Returns { scenes, repaired: [indexes], flagged: [indexes] } — scenes is a NEW
// array (inputs untouched).
async function repairVisualPrompts(scenes, { regenerate, maxAttempts = 2 } = {}) {
  if (typeof regenerate !== "function") {
    throw new Error("repairVisualPrompts requires a regenerate(...) callback");
  }
  const out = scenes.map((s) => ({ ...s }));
  const repaired = [];
  const flagged = [];

  // Recompute the audit against the CURRENT working set each pass so a fix in one
  // scene is reflected when judging the next (a regenerated prompt must not itself
  // collide with an already-cleared scene).
  let audit = auditVisualPrompts(out);
  let indexesWithIssues = [...new Set(audit.issues.map((i) => i.index))];

  for (const index of indexesWithIssues) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const sceneIssues = issuesForIndex(auditVisualPrompts(out).issues, index);
      if (sceneIssues.length === 0) break; // already clean (a prior scene's fix cleared it)

      const otherPrompts = out
        .map((s, i) => (i === index ? null : s.visual_prompt))
        .filter((p) => typeof p === "string" && p.trim());
      let newPrompt;
      try {
        newPrompt = await regenerate({
          scene: out[index],
          index,
          avoid: avoidInstruction(sceneIssues),
          otherPrompts,
        });
      } catch (_err) {
        break; // regeneration transport failure -> fall through to qa_flag
      }
      if (typeof newPrompt === "string" && newPrompt.trim()) {
        out[index] = { ...out[index], visual_prompt: newPrompt.trim() };
      }
    }
  }

  // Final audit. Flag ANY scene still dirty — not just the originally-dirty ones —
  // because a regenerated prompt can introduce a NEW collision on a previously
  // clean scene, and nothing may ship silently. A scene that started dirty and is
  // now clean counts as repaired.
  audit = auditVisualPrompts(out);
  const stillDirty = [...new Set(audit.issues.map((i) => i.index))];
  const originallyDirty = new Set(indexesWithIssues);
  for (const index of stillDirty) {
    const sceneIssues = issuesForIndex(audit.issues, index);
    const flag = {
      category: "visual_prompt",
      resolution: "pending",
      issue: avoidInstruction(sceneIssues) || "visual_prompt quality issue",
      types: [...new Set(sceneIssues.map((i) => i.type))],
    };
    const existing = Array.isArray(out[index].qa_flags) ? out[index].qa_flags : [];
    out[index] = { ...out[index], qa_flags: [...existing, flag] };
    flagged.push(index);
  }
  const stillDirtySet = new Set(stillDirty);
  for (const index of originallyDirty) {
    if (!stillDirtySet.has(index)) repaired.push(index);
  }

  return { scenes: out, repaired, flagged };
}

module.exports = {
  NONVISUAL_TERMS,
  NONVISUAL_RE,
  findNonVisual,
  firstFraming,
  jaccard,
  clauses,
  auditVisualPrompts,
  avoidInstruction,
  repairVisualPrompts,
  JACCARD_NEAR_DUP,
};

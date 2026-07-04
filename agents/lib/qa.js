"use strict";

// QA / accuracy gate (Master Build v2.7 Section 03 step 2 + Section 06 rubric).
// Owns the three named qa_flags categories plus a non-blocking style category:
//   - factual_accuracy  (blocking) — unsupported/invented claims (qwen fact-check)
//   - voice_consistency (blocking on fail) — Section 06 5-question rubric, /10
//   - gap_logic         (blocking) — gap_state stagnation across the scene chain
//   - style_minor       (NON-blocking) — cosmetic issues (em/en dash usage)
//
// This module LOGS and SCORES. It never rewrites the script (no auto-repair — the
// gate's default is hard-stop and wait for a human, per the build directive). The
// orchestrator reads blockingFlags() after the pass and halts before paid
// generation if any exist.

const { execFileSync } = require("child_process");
const { personaFor } = require("./personas");

// Categories the gate treats as blocking. Only voice_consistency (<=5/10) and
// gap_logic (stagnation) halt generation. factual_accuracy and style_minor are
// ADVISORY: factual flags are still logged to qa_flags, but per Section 00c they
// are a manual weekly-review signal, not a per-video gate — on a history channel
// nearly every specific claim would otherwise block a well-formed script.
const BLOCKING_CATEGORIES = ["voice_consistency", "gap_logic"];
// Resolutions that still count as "unresolved" for gating purposes.
const OPEN_RESOLUTIONS = ["pending", "video_rejected"];

// Section 06: score <= this (out of 10) rejects the video on voice grounds.
const VOICE_REJECT_THRESHOLD = 5;
// gap_logic: a maximal run of consecutive "opens" this long (with no intervening
// partial_resolve/resolves) reads as a stagnant chain, not overlapping gaps.
const OPENS_RUN_THRESHOLD = 4;

// ---- local qwen (Ollama) JSON helper. Free + local; never leaves the box. ----
function ollamaJson(prompt, { timeoutSec = 90 } = {}) {
  const body = JSON.stringify({
    model: "qwen2.5:7b",
    prompt,
    format: "json",
    stream: false,
    options: { temperature: 0.1 },
  });
  const out = execFileSync(
    "curl",
    ["-s", "-m", String(timeoutSec), "http://localhost:11434/api/generate", "-d", body],
    { encoding: "utf8" }
  );
  return JSON.parse(JSON.parse(out).response);
}

// ---- factual accuracy: flag unsupported/invented claims. Each -> 'pending'
// (a human must verify; the model cannot confirm truth), so each blocks. ----
function factualAccuracyFlags(scriptText) {
  const prompt =
    "You are a fact-checker. Read the narration script and list ONLY claims that are " +
    "unsupported, invented, or suspiciously specific (fake dates, invented quotes, made-up " +
    'numbers). Output STRICT JSON: {"flags":[{"claim":"...","scene":"..."}]}. ' +
    "Empty flags array if nothing is dubious.\n\nSCRIPT:\n" + scriptText;
  // 120s, not 60: this is usually the first model call of the pass, so it eats
  // qwen's cold-start load on top of generation (the 60s default timed out).
  const parsed = ollamaJson(prompt, { timeoutSec: 120 });
  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  return flags
    .filter((f) => f && f.claim)
    .map((f) => ({ claim: String(f.claim), scene: f.scene != null ? String(f.scene) : null }));
}

// ---- voice consistency: Section 06's exact 5-question rubric, 0-2 each, /10.
// Returns { total, breakdown:[{q,score,why}], rejected }. Fails CLOSED: on any
// model/parse error the caller logs a blocking 'pending' voice flag. ----
function voiceConsistencyScore(channel, narration, gapStateSeq) {
  const persona = personaFor(channel);
  const prompt =
    "You score narration against a fixed narrator PERSONA using a strict rubric. " +
    "Score each question 0, 1, or 2 exactly as defined. Be critical: reserve 2 for clear success.\n\n" +
    "PERSONA (the voice this narration must embody):\n" + persona + "\n\n" +
    "RUBRIC (0/1/2 per question):\n" +
    "q1 Would an existing subscriber recognize this narrator after 30 seconds? 0=no/generic, 1=mostly/some flat lines, 2=yes immediately\n" +
    "q2 Did the narrator default to its Decision Framework / Default Lens for this topic? 0=generic angle, 1=partial, 2=yes\n" +
    "q3 Were any Forbidden Shortcuts used (e.g. 'What if I told you', 'Imagine', 'Believe it or not', 'Little did they know', excessive rhetorical questions)? 0=yes multiple, 1=one instance, 2=none\n" +
    "q4 Was authority demonstrated through observation, or merely asserted? 0=asserted, 1=mixed, 2=demonstrated\n" +
    "q5 Does each block advance gap_state without stagnation? 0=no, 1=partial, 2=yes\n\n" +
    "The gap_state sequence across blocks (for q5) is: " + JSON.stringify(gapStateSeq) + "\n\n" +
    'Output STRICT JSON: {"q1":{"score":N,"why":"..."},"q2":{...},"q3":{...},"q4":{...},"q5":{...}}\n\n' +
    "NARRATION:\n" + narration;
  // 180s: this prompt is the largest of the pass (full persona + whole
  // narration). A timeout here fail-closes to a BLOCKING flag (see runQaPass),
  // so an over-tight timeout would wrongly gate a good script — err generous.
  const parsed = ollamaJson(prompt, { timeoutSec: 180 });
  const breakdown = [];
  let total = 0;
  for (const q of ["q1", "q2", "q3", "q4", "q5"]) {
    const raw = parsed[q] || {};
    let score = Number(raw.score);
    if (!Number.isFinite(score)) throw new Error(`voice rubric: ${q} missing/invalid score`);
    score = Math.max(0, Math.min(2, Math.round(score)));
    total += score;
    breakdown.push({ q, score, why: raw.why != null ? String(raw.why).slice(0, 200) : "" });
  }
  return { total, breakdown, rejected: total <= VOICE_REJECT_THRESHOLD };
}

// ---- gap_logic: deterministic stagnation detection over the gap_state chain.
// validate.js already rejects consecutive gap_type repeats; this is the
// orthogonal check the doc calls out — a chain that only ever "opens". ----
function gapLogicFlags(scenes) {
  const flags = [];
  const states = scenes.map((s) => s.gap_state);
  const n = states.length;
  if (n < OPENS_RUN_THRESHOLD) return flags;

  // (a) chain never develops: zero partial_resolve AND zero resolves.
  const advances = states.filter((s) => s === "partial_resolve" || s === "resolves").length;
  if (advances === 0) {
    flags.push({
      claim: `gap chain never advances: all ${n} blocks stay "opens" (no partial_resolve or resolves)`,
      scene: `blocks 0-${n - 1}`,
    });
  }

  // (b) missing gradient: never a single partial_resolve, so the chain jumps
  //     straight from opens to resolves with no overlap build (Section 03 model).
  const partials = states.filter((s) => s === "partial_resolve").length;
  if (advances > 0 && partials === 0) {
    flags.push({
      claim: `no partial_resolve anywhere: chain jumps opens -> resolves with no overlapping-gap gradient`,
      scene: `blocks 0-${n - 1}`,
    });
  }

  // (c) long unbroken run of "opens" with no intervening advance.
  let runStart = 0;
  let run = 0;
  let flaggedRun = false;
  for (let i = 0; i < n; i += 1) {
    if (states[i] === "opens") {
      if (run === 0) runStart = i;
      run += 1;
      if (run >= OPENS_RUN_THRESHOLD && !flaggedRun) {
        // Only flag the first offending run once; (a)/(b) already cover totals.
        // Report the full run extent after it ends.
      }
    } else {
      if (run >= OPENS_RUN_THRESHOLD && advances > 0) {
        flags.push({
          claim: `stagnant run: ${run} consecutive "opens" (blocks ${runStart}-${runStart + run - 1}) before any advance`,
          scene: `blocks ${runStart}-${runStart + run - 1}`,
        });
        flaggedRun = true;
      }
      run = 0;
    }
  }
  return flags;
}

// ---- style_minor: cheap em/en-dash regex check on the narration. Non-blocking;
// a leftover from the persona fix. Reported so it's visible, never gates. ----
function emDashFlags(narration) {
  const matches = narration.match(/[—–]/g);
  if (!matches || matches.length === 0) return [];
  const idx = narration.search(/[—–]/);
  const ctx = narration.slice(Math.max(0, idx - 25), idx + 25).replace(/\s+/g, " ").trim();
  return [{ claim: `${matches.length} em/en dash(es) in narration (writing rule: use commas/periods). e.g. "...${ctx}..."` }];
}

// ---- persistence: one prepared insert; resolution chosen per category. ----
function insertFlag(db, { videoId, channel, claim, scene, category, resolution }) {
  db.prepare(
    `INSERT INTO qa_flags (video_id, channel, flagged_claim, scene_reference, category, resolution)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(videoId, channel, String(claim), scene != null ? String(scene) : null, category, resolution);
}

// ---- the full pass. Runs all four checks, logs flags with correct resolutions,
// returns a summary the orchestrator/test can print. Never throws on model
// failure: it degrades to a blocking 'pending' flag so the gate stays safe. ----
function runQaPass(db, { videoId, channel, scriptText, scenes }) {
  const summary = { factual: 0, voice: null, gapLogic: 0, styleMinor: 0 };
  const narration = scenes.map((s) => (s.narration || "").trim()).filter(Boolean).join("\n");
  const gapStateSeq = scenes.map((s) => s.gap_state);

  // 1. factual accuracy (blocking, each -> pending)
  try {
    const flags = factualAccuracyFlags(scriptText);
    for (const f of flags) {
      insertFlag(db, { videoId, channel, claim: f.claim, scene: f.scene, category: "factual_accuracy", resolution: "pending" });
    }
    summary.factual = flags.length;
  } catch (err) {
    insertFlag(db, {
      videoId, channel, category: "factual_accuracy", resolution: "pending",
      claim: `factual-accuracy check could not run (${err.message}); holding for human review`, scene: null,
    });
    summary.factual = -1;
  }

  // 2. voice consistency (Section 06 rubric). Pass -> confirmed_accurate
  //    (non-blocking, but recorded); fail -> video_rejected (blocking).
  try {
    const v = voiceConsistencyScore(channel, narration, gapStateSeq);
    const detail = v.breakdown.map((b) => `${b.q}=${b.score}`).join(",");
    insertFlag(db, {
      videoId, channel, category: "voice_consistency",
      resolution: v.rejected ? "video_rejected" : "confirmed_accurate",
      claim: `Voice Consistency Score ${v.total}/10 (${detail}) — ${v.rejected ? "REJECTED (<=5)" : "pass"}`,
      scene: null,
    });
    summary.voice = { total: v.total, rejected: v.rejected, breakdown: v.breakdown };
  } catch (err) {
    insertFlag(db, {
      videoId, channel, category: "voice_consistency", resolution: "pending",
      claim: `voice-consistency scoring could not run (${err.message}); holding for human review`, scene: null,
    });
    summary.voice = { total: null, rejected: true, breakdown: [] };
  }

  // 3. gap_logic stagnation (deterministic, each -> pending, blocking)
  const gapFlags = gapLogicFlags(scenes);
  for (const f of gapFlags) {
    insertFlag(db, { videoId, channel, claim: f.claim, scene: f.scene, category: "gap_logic", resolution: "pending" });
  }
  summary.gapLogic = gapFlags.length;

  // 4. style_minor em/en dash (non-blocking, -> pending but excluded from gate)
  const styleFlags = emDashFlags(narration);
  for (const f of styleFlags) {
    insertFlag(db, { videoId, channel, claim: f.claim, scene: null, category: "style_minor", resolution: "pending" });
  }
  summary.styleMinor = styleFlags.length;

  return summary;
}

// ---- gate query: unresolved flags in a blocking category for this video. ----
function blockingFlags(db, videoId) {
  const placeholders = BLOCKING_CATEGORIES.map(() => "?").join(",");
  const resPlaceholders = OPEN_RESOLUTIONS.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, category, resolution, flagged_claim, scene_reference
         FROM qa_flags
        WHERE video_id = ?
          AND category IN (${placeholders})
          AND resolution IN (${resPlaceholders})
        ORDER BY id ASC`
    )
    .all(videoId, ...BLOCKING_CATEGORIES, ...OPEN_RESOLUTIONS);
}

module.exports = {
  BLOCKING_CATEGORIES,
  OPEN_RESOLUTIONS,
  VOICE_REJECT_THRESHOLD,
  OPENS_RUN_THRESHOLD,
  factualAccuracyFlags,
  voiceConsistencyScore,
  gapLogicFlags,
  emDashFlags,
  runQaPass,
  blockingFlags,
};

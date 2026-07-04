"use strict";

// Validation and shaping for the scene manifest produced by stage 2. Fail fast
// at the system boundary: qwen output is external data and is never trusted
// (coding-style: validate all input at boundaries).

const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };

// v2.7 gap-chain schema (Master Build Section 00c). Each block declares a
// gap_type from a rotating taxonomy and a gap_state describing where it sits in
// the overlapping-gap chain. A block may open a new tension before the previous
// block's gap has resolved.
const GAP_TYPES = [
  "new_fact",
  "contradiction",
  "escalation",
  "reframing",
  "hidden_implication",
  "anomaly",
  "causal_fragment",
  "perspective_shift",
];
const GAP_STATES = ["opens", "partial_resolve", "resolves"];

// Render block (Section 07/08). Each scene carries a nested `render` object that
// anchors the still/hero prompt for period + setting accuracy — the guard against
// era drift. `era` and `subject_type` use a fixed controlled vocabulary (validated
// fail-fast, same pattern as gap_type) so garbage values are caught at the source;
// `location` is a free setting anchor; `style` carries the sentinel STYLE_DEFAULT
// ("channel_default") in the normal case — meaning "use the channel's locked
// CHANNEL_STYLE" (resolved in flyt-stills.py) — or a deliberate art-style override.
const ERAS = ["prehistoric", "ancient", "medieval", "early_modern", "industrial", "modern"];
const SUBJECT_TYPES = [
  "period_people", // people of the scene's own historical era
  "modern_people", // present-day people — the deliberate contrast, NOT the channel's era
  "animal",
  "object",
  "landscape",
  "structure",
  "abstract",
];
const STYLE_DEFAULT = "channel_default";

function channelDir(channel) {
  const dir = CHANNEL_DIRS[channel];
  if (!dir) throw new Error(`unknown channel "${channel}" (expected channel_a or channel_b)`);
  return dir;
}

// Turn a title into a filesystem-safe slug.
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

// Validate the qwen scene object and return a normalized manifest. Throws with
// a specific message on the first problem found. `channel` gates the hero rule:
// channel_a is stills-only (0 heroes), every other channel keeps the 1-2 rule.
function validateScenes(sceneObj, channel) {
  if (!sceneObj || typeof sceneObj !== "object") {
    throw new Error("manifest is not an object");
  }
  const scenes = sceneObj.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("manifest.scenes must be a non-empty array");
  }

  let heroCount = 0;
  let expectedStart = 0;

  scenes.forEach((scene, i) => {
    const at = `scene[${i}]`;
    if (typeof scene.start !== "number" || typeof scene.end !== "number") {
      throw new Error(`${at}: start and end must be numbers`);
    }
    if (scene.end <= scene.start) {
      throw new Error(`${at}: end (${scene.end}) must be greater than start (${scene.start})`);
    }
    if (scene.start !== expectedStart) {
      throw new Error(`${at}: start ${scene.start} is not contiguous (expected ${expectedStart})`);
    }
    if (scene.asset_type !== "still" && scene.asset_type !== "hero") {
      throw new Error(`${at}: asset_type must be "still" or "hero" (got "${scene.asset_type}")`);
    }
    if (typeof scene.narration !== "string" || scene.narration.trim() === "") {
      throw new Error(`${at}: narration must be a non-empty string`);
    }
    // visual_prompt feeds the stills/hero generators (flyt-stills.py, Seedance
    // wrapper). qwen's JSON contract declares it, but a missing/empty value must
    // fail here at the source, not silently break generation downstream.
    if (typeof scene.visual_prompt !== "string" || scene.visual_prompt.trim() === "") {
      throw new Error(`${at}: visual_prompt must be a non-empty string`);
    }
    // on_screen_text is the assembly-stage caption; empty string is allowed
    // (qwen returns "" when a scene has no caption) but it must be present.
    if (typeof scene.on_screen_text !== "string") {
      throw new Error(`${at}: on_screen_text must be a string (empty string allowed)`);
    }
    // v2.7 gap-chain fields (Section 00c). Every block must declare a valid
    // gap_type and gap_state, and no two consecutive blocks may repeat the same
    // gap_type.
    if (!GAP_TYPES.includes(scene.gap_type)) {
      throw new Error(
        `${at}: gap_type must be one of ${GAP_TYPES.join(", ")} (got "${scene.gap_type}")`
      );
    }
    if (!GAP_STATES.includes(scene.gap_state)) {
      throw new Error(
        `${at}: gap_state must be one of ${GAP_STATES.join(", ")} (got "${scene.gap_state}")`
      );
    }
    if (i > 0 && scene.gap_type === scenes[i - 1].gap_type) {
      throw new Error(
        `${at}: gap_type "${scene.gap_type}" repeats the previous block's gap_type (no consecutive repeats)`
      );
    }
    // Render block (Section 07/08): nested { era, location, subject_type, style }.
    // era + subject_type are controlled vocab (fail-fast, same as gap_type); the
    // subject_type token is the drift guard (period_people vs modern_people).
    const render = scene.render;
    if (!render || typeof render !== "object" || Array.isArray(render)) {
      throw new Error(`${at}: render must be an object { era, location, subject_type, style }`);
    }
    if (!ERAS.includes(render.era)) {
      throw new Error(`${at}: render.era must be one of ${ERAS.join(", ")} (got "${render.era}")`);
    }
    if (!SUBJECT_TYPES.includes(render.subject_type)) {
      throw new Error(`${at}: render.subject_type must be one of ${SUBJECT_TYPES.join(", ")} (got "${render.subject_type}")`);
    }
    // location is a free-text setting anchor, not controlled vocab — it must be a
    // string but MAY be empty (qwen sometimes omits it; build_prompt just skips a
    // blank one). The strict fail-fast fields are era + subject_type (the drift guard).
    if (typeof render.location !== "string") {
      throw new Error(`${at}: render.location must be a string (empty string allowed)`);
    }
    if (typeof render.style !== "string" || render.style.trim() === "") {
      throw new Error(`${at}: render.style must be a non-empty string ('${STYLE_DEFAULT}' unless overriding)`);
    }

    if (scene.asset_type === "hero") heroCount += 1;
    expectedStart = scene.end;
  });

  if (channel === "channel_a") {
    if (heroCount !== 0) {
      throw new Error(`channel_a is stills-only: expected 0 hero scenes, got ${heroCount}`);
    }
  } else if (heroCount < 1 || heroCount > 2) {
    throw new Error(`expected 1-2 hero scenes, got ${heroCount}`);
  }

  return { scenes, totalDurationSeconds: expectedStart, heroCount };
}

// Deterministic backstop applied to qwen's raw output BEFORE validateScenes, so
// two common stochastic slips (adjacent gap_type repeats; wrong hero count) get
// fixed in-process instead of forcing a full stochastic regeneration. Returns a
// NEW scene object (no mutation of the input, per coding-style).
function normalizeScenes(sceneObj, channel) {
  if (!sceneObj || typeof sceneObj !== "object" || !Array.isArray(sceneObj.scenes)) {
    return sceneObj; // let validateScenes raise the precise, well-worded error
  }
  const scenes = sceneObj.scenes.map((s) => ({ ...s }));

  // 1. No two ADJACENT scenes share a gap_type. Left-to-right: whenever scene[i]
  //    repeats scene[i-1], reassign it to a valid gap_type that differs from BOTH
  //    neighbours (8 types, at most 2 excluded, so one always exists).
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].gap_type === scenes[i - 1].gap_type) {
      const prev = scenes[i - 1].gap_type;
      const next = i + 1 < scenes.length ? scenes[i + 1].gap_type : null;
      const replacement = GAP_TYPES.find((g) => g !== prev && g !== next);
      if (replacement) scenes[i] = { ...scenes[i], gap_type: replacement };
    }
  }

  // 2. Hero handling is channel-gated. channel_a is stills-only: demote any hero
  //    qwen emitted to still (no video clips break the stick-figure look). Every
  //    other channel keeps the 1-2 clamp: if zero, promote a mid-script escalation
  //    beat (the natural dramatic peak; fall back to the middle scene); if more
  //    than two, keep the first two and demote the rest.
  if (channel === "channel_a") {
    for (let i = 0; i < scenes.length; i += 1) {
      if (scenes[i].asset_type === "hero") scenes[i] = { ...scenes[i], asset_type: "still" };
    }
  } else {
    const heroIdx = scenes.map((s, i) => (s.asset_type === "hero" ? i : -1)).filter((i) => i >= 0);
    if (scenes.length > 0 && heroIdx.length === 0) {
      const mid = Math.floor(scenes.length / 2);
      const escalations = scenes
        .map((s, i) => (s.gap_type === "escalation" ? i : -1))
        .filter((i) => i >= 0);
      const pick = escalations.length
        ? escalations.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))
        : mid;
      scenes[pick] = { ...scenes[pick], asset_type: "hero" };
    } else if (heroIdx.length > 2) {
      heroIdx.slice(2).forEach((i) => {
        scenes[i] = { ...scenes[i], asset_type: "still" };
      });
    }
  }

  return { ...sceneObj, scenes };
}

module.exports = { channelDir, slugify, validateScenes, normalizeScenes, CHANNEL_DIRS };

"use strict";

// Stage 2 (whole-script -> scene JSON), registry path. Runs the same Groq ->
// Cerebras chain as Stage-1 prose (llm_registry.js), but for structured scene
// output. Two reasons it lives here and not on local qwen2.5:7b: (1) a full
// 4-5 min script overflows the small model's context, which truncated the JSON
// and flattened the gap_state chain to all "opens"; (2) a 120B model reliably
// produces the overlapping gap chain and the data_visual tagging.
//
// CUT-POINT DESIGN (not "copy the narration"): asking any model to re-emit the
// narration verbatim while segmenting made it abridge — it dropped ~half the
// script's sentences. So the model never touches narration text. This module
// splits the script into NUMBERED sentences (script_segments.js, losslessly) and
// the model only assigns each scene a contiguous range of sentence numbers plus
// the semantic fields (gap_type, gap_state, render, visual_prompt). Code then
// reconstructs each scene's narration by slicing those exact sentences and
// computes timing from word count. 100% verbatim coverage is guaranteed by
// construction; validateScenes' coverage assertion is the belt-and-suspenders net.

const { resolveChain } = require("./llm_registry");
const {
  toCanonicalNarration,
  splitSentences,
  normalizeForCompare,
} = require("./script_segments");

// Deterministic structure, not creative prose. Overrides the registry's
// prose-tuned temperature.
const SCENE_JSON_TEMPERATURE = 0.2;

// gpt-oss-120b (both providers' current model) is a REASONING model. At the
// default reasoning effort it burns the ENTIRE max_tokens budget on hidden
// reasoning and emits zero content (verified: 5997 reasoning tokens,
// finish_reason "length", empty JSON). "low" collapses that to ~170 reasoning
// tokens on Groq so the model actually emits the manifest. Per-call-type choice:
// the Stage-1 prose path (groq.js) does not need it.
const SCENE_JSON_REASONING_EFFORT = "low";

// Narration -> runtime estimate, matching the pacing the prompt used before and
// the VoxCPM narrator's rough rate. Timing is computed here (not model-supplied)
// so scenes are contiguous and monotonic by construction.
const WORDS_PER_SECOND = 2.5;

const SYSTEM_PROMPT =
  "You segment a narration script into a scene manifest. You NEVER copy or rewrite the narration text; you only assign each scene a contiguous range of the numbered sentences given to you, plus the scene's structured fields. Output ONLY valid JSON matching the requested shape, no prose, no markdown fences.";

// Build the user prompt: the semantic rules (gap chain, render vocab, data_visual)
// carried over verbatim from the proven prompt, with the narration-copying and
// time-estimating rules REPLACED by "assign a contiguous sentence range". The
// sentences are presented pre-numbered; the model's whole job on text is to pick
// where scenes begin and end.
function buildCutPointPrompt({ title, entity, situation, channel, sentences }) {
  const heroRule =
    channel === "channel_a"
      ? '- HARD REQUIREMENT: EVERY scene is asset_type "still". This channel is stills-only — NEVER use asset_type "hero" (no video clips at all). A generation with any hero scene is INVALID and will be rejected.'
      : '- HARD REQUIREMENT: exactly 1 or 2 scenes in the whole video MUST have asset_type "hero" (NEVER zero, NEVER more than two) — the single most visually dramatic moment, or two at most. EVERY other scene is asset_type "still". A generation with zero hero scenes is INVALID and will be rejected.';

  const numbered = sentences.map((s, i) => `${i + 1}. ${s.replace(/\s+/g, " ").trim()}`).join("\n");
  const N = sentences.length;

  return [
    "You convert a narration script into a scene manifest. Output ONLY valid JSON, no prose.",
    "",
    "The script has been split into NUMBERED sentences (below). You assign each scene a contiguous range of sentence numbers; you do NOT write, copy, paraphrase, or reproduce any narration text yourself.",
    "",
    "Rules:",
    `- COVERAGE (hard requirement): the scenes MUST cover sentences 1 through ${N} exactly once, in order, with NO gaps and NO overlaps. scene[0].sentence_start MUST be 1. Each scene's sentence_start MUST equal the previous scene's sentence_end + 1. The final scene's sentence_end MUST be ${N}.`,
    "- SCENE GRANULARITY (tighter pacing): target ONE sentence per scene. Cut on sentence boundaries only — never split mid-sentence. Default to a 1-sentence scene so each still covers a short beat and the video stays visually dynamic. ONLY merge two consecutive sentences into one scene when a sentence is a very short fragment (roughly 5 words or fewer, e.g. \"It worked.\" or \"Then everything changed.\") that cannot stand as its own shot; attach that fragment to the neighbor it belongs with. Never group more than two sentences into a single scene. A single sentence stating one quantity (a duration, distance, proportion, count, or trend) is ALWAYS its OWN one-sentence scene with render.subject_type \"data_visual\" (see the data_visual rules below).",
    "- Do NOT output start/end times or any narration text. Timing and narration are reconstructed downstream from your sentence ranges.",
    heroRule,
    "- visual_prompt: a concrete, filmable SHOT DESCRIPTION for the scene's sentences, not a mood summary. Each visual_prompt MUST specify, in this spirit:",
    "    (a) FRAMING / ANGLE: e.g. wide establishing shot, low-angle close-up, overhead/top-down, over-the-shoulder, side profile. Never omit the shot type.",
    "    (b) SUBJECT COUNT: roughly how many subjects are in frame (e.g. a single figure, two figures, a small group of five). Be specific, not 'people'.",
    "    (c) A SPECIFIC DEPICTED ACTION: something physically visible and happening now (e.g. 'chipping a stone blade', 'dragging a carcass toward the cave mouth'). NOT a vague internal state like 'reflecting on a practice', 'contemplating survival', or 'feeling safe'. If you cannot see it, do not write it.",
    "    (d) LIGHTING INTENT where relevant: e.g. firelight from below, pale moonlight, dawn backlight, deep shadow.",
    "- visual_prompt HARD RULE — NO NON-VISUAL / AUDIO CUES. Strip anything that cannot be seen. TEST every clause: if it describes something HEARD, something FELT as temperature, or an AUDITORY/ATMOSPHERIC quality rather than something you could photograph, it does NOT belong in visual_prompt. This includes sounds ('the howl of wolves', 'crackling fire', 'electric hum', 'distant voices', 'drumbeats'), silence framed as an event ('growing silent', 'the hush', 'moving silently'), temperature/sensation ('temperature falling', 'the cold biting'), smells, and abstract emotion. An image model cannot render a sound, a silence, or a temperature — describe only what the camera sees.",
    "- visual_prompt HARD RULE — NO REPETITION ACROSS SCENES. No two visual_prompts may be substitutable for each other. TWO separate constraints, both required: (1) CONSECUTIVE scenes MUST use a DIFFERENT framing/shot type than the scene before them. (2) NO ACTION CLAUSE may be reused verbatim or near-verbatim in more than one scene, EVEN IF the framing differs. Every scene must describe a genuinely different action, focus, and composition, not the same moment shot from a new angle.",
    "- on_screen_text: a short caption for the scene, or an empty string if none.",
    "- gap_type: the kind of curiosity gap this scene opens. One of: new_fact, contradiction, escalation, reframing, hidden_implication, anomaly, causal_fragment, perspective_shift. HARD REQUIREMENT: no two ADJACENT scenes may share the same gap_type. scene[n].gap_type MUST differ from scene[n-1].gap_type for every n.",
    "- gap_state: where this scene sits in the OVERLAPPING gap chain. One of: opens (introduces a new tension/question), partial_resolve (advances or partly answers an earlier gap while it stays partly open), resolves (fully closes a gap). The chain is a PROGRESSION, not a flat list: earlier gaps get partly paid off while new ones open, so the states MUST evolve across scenes — do not default every scene to \"opens\". HARD REQUIREMENTS: (1) the first scene is \"opens\". (2) The sequence MUST contain at least one \"partial_resolve\" — a mid-video scene that answers PART of an earlier question without fully closing it. A chain that is only \"opens\" ending in a single \"resolves\" is INVALID and will be rejected. (3) Never stack more than 3 \"opens\" in a row without an intervening \"partial_resolve\" or \"resolves\". (4) The final scene should \"resolves\". Assign the state that HONESTLY matches what each scene does to the running set of open questions.",
    "- render: an object anchoring the scene's visuals, with EXACTLY these four fields:",
    "    render.era: the time period depicted. MUST be one of exactly: prehistoric, ancient, medieval, early_modern, industrial, modern. Use \"modern\" ONLY for a deliberate present-day contrast scene, never for the historical subject itself.",
    "    render.location: a short free-text setting anchor (e.g. \"inside a firelit cave\", \"a snowy tundra at night\").",
    "    render.subject_type: who or what is in frame. MUST be one of exactly: period_people, modern_people, animal, object, landscape, structure, abstract, data_visual. Use period_people for people of the scene's own historical era; use modern_people ONLY for present-day contrast people (pair it with era \"modern\").",
    "    render.subject_type \"data_visual\" RULES: whenever a scene's ONE sentence centers on ONE quantifiable fact (a duration, a distance, a proportion, a count, a trend — e.g. 'up to fourteen hours of darkness', 'sleep came in two blocks'), give that sentence its OWN scene with subject_type \"data_visual\" — the script deliberately plants these anchors and they become brief data graphics. For a data_visual scene the visual_prompt describes a stylized data graphic in the channel's SAME flat 2D minimalist style (never a busy infographic): name ONE layout (timeline bar, radius diagram, donut chart, simple line graph, or icon count), the ONE quantity it shows, and an on-screen label of 1-3 words MAXIMUM. Keep data_visual scenes single-sentence, never make two adjacent scenes data_visual, and use them sparingly as occasional punctuation between character scenes, not on a schedule.",
    "    render.style: set to \"channel_default\" (use this almost always). Only use a different value for a deliberate art-style exception.",
    "",
    "JSON shape (note: sentence_start/sentence_end, NOT narration, NOT times):",
    '{ "scenes": [ { "index": 1, "beat": "hook", "sentence_start": 1, "sentence_end": 1, "asset_type": "still", "gap_type": "new_fact", "gap_state": "opens", "render": { "era": "prehistoric", "location": "inside a firelit cave", "subject_type": "period_people", "style": "channel_default" }, "visual_prompt": "...", "on_screen_text": "..." }, { "index": 2, "beat": "context", "sentence_start": 2, "sentence_end": 2, "asset_type": "still", "gap_type": "escalation", "gap_state": "opens", "render": { "era": "prehistoric", "location": "", "subject_type": "data_visual", "style": "channel_default" }, "visual_prompt": "a horizontal timeline bar showing fourteen hours of darkness, dark baseline with one accent segment", "on_screen_text": "14 hours" } ] }',
    "",
    `channel: ${channel}`,
    `title: ${title}`,
    `entity: ${entity}`,
    `situation: ${situation}`,
    "",
    `NUMBERED SENTENCES (assign every one, 1 through ${N}, to exactly one scene, in order):`,
    numbered,
  ].join("\n");
}

// Validate the model's sentence ranges and reconstruct each scene's narration by
// slicing the exact source segments (100% verbatim coverage), then compute
// contiguous integer timing from word counts. Throws on any range violation so
// the caller's retry-then-alert loop handles it. Strips the sentence_start/end
// fields (not part of the manifest schema) and adds narration/start/end.
function reconstructScenes(rawScenes, segments) {
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new Error("scene JSON has no scenes array");
  }
  const N = segments.length;
  let expectedStart = 1;
  let cumWords = 0;
  let prevEnd = 0;
  const out = rawScenes.map((s, i) => {
    const a = s.sentence_start;
    const b = s.sentence_end;
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`scene[${i}]: sentence_start/sentence_end must be integers (got ${a}/${b})`);
    }
    if (a !== expectedStart) {
      throw new Error(`scene[${i}]: sentence_start ${a} is not contiguous (expected ${expectedStart})`);
    }
    if (b < a) {
      throw new Error(`scene[${i}]: sentence_end ${b} is before sentence_start ${a}`);
    }
    if (b > N) {
      throw new Error(`scene[${i}]: sentence_end ${b} exceeds sentence count ${N}`);
    }
    const narration = segments.slice(a - 1, b).join("").replace(/\s+/g, " ").trim();
    cumWords += narration.split(/\s+/).filter(Boolean).length;
    const start = prevEnd;
    let end = Math.round(cumWords / WORDS_PER_SECOND);
    if (end <= start) end = start + 1; // every scene gets at least 1s
    prevEnd = end;
    expectedStart = b + 1;
    const { sentence_start, sentence_end, ...rest } = s;
    return { ...rest, narration, start, end };
  });
  if (expectedStart !== N + 1) {
    throw new Error(`scenes cover sentences 1..${expectedStart - 1}, but the script has ${N} (missing ${N - (expectedStart - 1)})`);
  }
  return { scenes: out };
}

// One OpenAI-compatible chat call in JSON mode. Returns the parsed object, or
// null on any transport/HTTP/parse failure so the caller can fall through to the
// next provider (mirrors groq.js callChat's soft-fail contract). A Groq 413 (the
// 8000 TPM input+max_tokens ceiling) lands here as a not-ok response -> null ->
// fall through to Cerebras, which has no such cap.
async function callSceneJsonChat(url, apiKey, model, userPrompt, maxTokens) {
  if (!apiKey) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: SCENE_JSON_TEMPERATURE,
        reasoning_effort: SCENE_JSON_REASONING_EFFORT,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      process.stderr.write(`[warn] ${url} HTTP ${res.status}: ${detail.slice(0, 300)}\n`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      process.stderr.write(`[warn] ${url} returned empty scene-JSON content\n`);
      return null;
    }
    try {
      return JSON.parse(content);
    } catch (err) {
      process.stderr.write(`[warn] ${url} scene JSON did not parse: ${err.message}\n`);
      return null;
    }
  } catch (err) {
    process.stderr.write(`[warn] ${url} scene-JSON request failed: ${err.message}\n`);
    return null;
  }
}

// Convert a whole prose script into scene JSON by walking the channel's resolved
// provider chain (Groq then Cerebras by default). The first provider that returns
// parseable JSON whose sentence ranges reconstruct cleanly wins. Throws only if
// every configured provider fails, so the caller's retry-then-alert loop
// (Section 03 step 6) behaves as before. Returns { scenes } with narration +
// start/end filled in — the same shape normalizeScenes/validateScenes expect.
async function generateSceneJson({ env, channel, title, entity, situation, scriptText }) {
  const canonical = toCanonicalNarration(scriptText);
  const segments = splitSentences(canonical);
  if (segments.length === 0) throw new Error("script produced no sentences to segment");
  const userPrompt = buildCutPointPrompt({ title, entity, situation, channel, sentences: segments });

  const chain = resolveChain(channel, env || {});
  if (!chain.length) throw new Error(`no llm providers configured for channel '${channel}'`);

  let lastErr = null;
  let attempted = false;
  for (const p of chain) {
    if (!p.apiKey) continue; // unconfigured provider — skip to the next
    if (attempted) process.stderr.write(`[warn] scene JSON falling back to ${p.id}\n`);
    attempted = true;
    const raw = await callSceneJsonChat(p.endpoint, p.apiKey, p.model, userPrompt, p.max_tokens);
    if (raw === null) continue; // provider soft-failed — try the next
    try {
      return reconstructScenes(raw.scenes, segments);
    } catch (err) {
      // Valid JSON but bad sentence ranges: record and fall through to the next
      // provider rather than shipping incomplete coverage.
      lastErr = err;
      process.stderr.write(`[warn] ${p.id} scene ranges invalid: ${err.message}\n`);
    }
  }

  if (!attempted) {
    const names = chain.map((p) => p.id).join(" / ");
    throw new Error(`all scene-JSON providers unconfigured (${names}) — check auth keys in ~/.openclaw/.env`);
  }
  throw new Error(`all scene-JSON providers failed to produce a valid manifest${lastErr ? ` (last: ${lastErr.message})` : ""}`);
}

module.exports = { generateSceneJson, buildCutPointPrompt, reconstructScenes };

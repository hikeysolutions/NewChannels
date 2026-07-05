"use strict";

// Stage 2 of the two-stage model: the local qwen2.5:7b model on Ollama turns
// the prose script into scene JSON with timestamps. This is the JSON step, kept
// on the local model per the OpenClaw rule "Never use Gemini for JSON - use
// qwen2.5:7b Ollama". Zero marginal cost, no network beyond localhost.

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";

function buildPrompt({ title, entity, situation, channel, scriptText }) {
  // Hero rule is channel-gated: channel_a is stills-only (no video clips break
  // the stick-figure look); other channels keep the 1-2 hero-scene rule.
  const heroRule = channel === "channel_a"
    ? "- HARD REQUIREMENT: EVERY scene is asset_type \"still\". This channel is stills-only — NEVER use asset_type \"hero\" (no video clips at all). A generation with any hero scene is INVALID and will be rejected."
    : "- HARD REQUIREMENT: exactly 1 or 2 scenes in the whole video MUST have asset_type \"hero\" (NEVER zero, NEVER more than two) — the single most visually dramatic moment, or two at most. EVERY other scene is asset_type \"still\". A generation with zero hero scenes is INVALID and will be rejected.";
  return [
    "You convert a narration script into a scene manifest. Output ONLY valid JSON, no prose.",
    "",
    "Rules:",
    "- Split the script into ordered scenes, one scene per beat or natural narration chunk.",
    "- Give each scene a start and end time in whole seconds. Scenes are contiguous: scene[n].start == scene[n-1].end. First scene starts at 0.",
    "- Estimate duration from narration length at roughly 2.5 words per second.",
    heroRule,
    "- visual_prompt: a concrete, filmable SHOT DESCRIPTION, not a mood summary. Each visual_prompt MUST specify, in this spirit:",
    "    (a) FRAMING / ANGLE: e.g. wide establishing shot, low-angle close-up, overhead/top-down, over-the-shoulder, side profile. Never omit the shot type.",
    "    (b) SUBJECT COUNT: roughly how many subjects are in frame (e.g. a single figure, two figures, a small group of five). Be specific, not 'people'.",
    "    (c) A SPECIFIC DEPICTED ACTION: something physically visible and happening now (e.g. 'chipping a stone blade', 'dragging a carcass toward the cave mouth'). NOT a vague internal state like 'reflecting on a practice', 'contemplating survival', or 'feeling safe'. If you cannot see it, do not write it.",
    "    (d) LIGHTING INTENT where relevant: e.g. firelight from below, pale moonlight, dawn backlight, deep shadow.",
    "- visual_prompt HARD RULE — NO NON-VISUAL / AUDIO CUES. Strip anything that cannot be seen. TEST every clause: if it describes something HEARD, something FELT as temperature, or an AUDITORY/ATMOSPHERIC quality rather than something you could photograph, it does NOT belong in visual_prompt. This includes sounds ('the howl of wolves', 'crackling fire', 'electric hum', 'distant voices', 'rhythm of drumbeats filling the night air', 'drumbeats'), silence framed as an event ('growing silent', 'the world falling silent', 'the hush', 'moving silently'), temperature/sensation ('temperature falling', 'the cold biting', 'warmth on the skin'), smells, and abstract emotion. Sound, silence, temperature, and smell belong in narration ONLY, never in an image prompt. An image model cannot render a sound, a silence, or a temperature — describe only what the camera sees.",
    "- visual_prompt HARD RULE — NO REPETITION ACROSS SCENES. No two visual_prompts may be substitutable for each other. TWO separate constraints, both required: (1) CONSECUTIVE scenes MUST use a DIFFERENT framing/shot type than the scene before them (do not use the same shot type twice in a row). (2) NO ACTION CLAUSE may be reused verbatim or near-verbatim in more than one scene, EVEN IF the framing differs. It is NOT enough to change only the shot type while repeating the same described action — e.g. writing 'hands passing tools, voices low, eyes gazing into the flickering flames' in three scenes with only the framing changed is a REPEATED STOCK PHRASE a viewer will notice, and is FORBIDDEN. Every scene must describe a genuinely different action, focus, and composition, not the same moment shot from a new angle. Never settle into a repeated template.",
    "- on_screen_text: a short caption for the scene, or an empty string if none.",
    "- narration: the scene's narration text copied VERBATIM from the script. Do NOT paraphrase, summarize, smooth, rewrite, or 'improve' it. Preserve exact wording, punctuation, and sentence rhythm so the narrator's voice is not flattened. The concatenation of all scenes' narration must equal the original script text.",
    "- gap_type: the kind of curiosity gap this scene opens. One of: new_fact, contradiction, escalation, reframing, hidden_implication, anomaly, causal_fragment, perspective_shift. HARD REQUIREMENT: no two ADJACENT scenes may share the same gap_type. scene[n].gap_type MUST differ from scene[n-1].gap_type for every n. Change it on every scene; never copy the previous scene's value.",
    "- gap_state: where this scene sits in the OVERLAPPING gap chain. One of: opens (introduces a new tension/question), partial_resolve (advances or partly answers an earlier gap while it stays partly open), resolves (fully closes a gap). The chain is a PROGRESSION, not a flat list: as the video moves forward, earlier gaps get partly paid off while new ones open, so the states MUST evolve across scenes — do not default every scene to \"opens\". HARD REQUIREMENTS: (1) the first scene is \"opens\". (2) The sequence MUST contain at least one \"partial_resolve\" — a mid-video scene that answers PART of an earlier question without fully closing it. A chain that is only \"opens\" ending in a single \"resolves\" is INVALID and will be rejected. (3) Never stack more than 3 \"opens\" in a row without an intervening \"partial_resolve\" or \"resolves\"; break a long run by paying off an earlier gap. (4) The final scene should \"resolves\". Assign the state that HONESTLY matches what each scene does to the running set of open questions; place the partial_resolve(s) where the narration actually revisits an earlier thread, not on a fixed schedule.",
    "- render: an object anchoring the scene's visuals, with EXACTLY these four fields:",
    "    render.era: the time period depicted. MUST be one of exactly: prehistoric, ancient, medieval, early_modern, industrial, modern. Pick the era matching the scene's content. Use \"modern\" ONLY for a deliberate present-day contrast scene, never for the historical subject itself.",
    "    render.location: a short free-text setting anchor (e.g. \"inside a firelit cave\", \"a snowy tundra at night\").",
    "    render.subject_type: who or what is in frame. MUST be one of exactly: period_people, modern_people, animal, object, landscape, structure, abstract, data_visual. Use period_people for people of the scene's own historical era; use modern_people ONLY for present-day contrast people (pair it with era \"modern\").",
    "    render.subject_type \"data_visual\" RULES: use it ONLY when the scene's narration states one quantifiable fact (a duration, a distance, a proportion, a count, a trend) that a simple graphic makes clearer than a character scene. For a data_visual scene the visual_prompt describes a stylized data graphic in the channel's SAME flat 2D minimalist style (never a busy infographic): name ONE layout (timeline bar, radius diagram, donut chart, simple line graph, or icon count), the ONE quantity it shows, and an on-screen label of 1-3 words MAXIMUM (longer explanation stays in narration, never on screen). Keep data_visual scenes SHORT (one or two narration sentences), never make two adjacent scenes data_visual, and use them sparingly as occasional punctuation between character scenes, not on a schedule.",
    "    render.style: set to \"channel_default\" (use this almost always). Only use a different value for a deliberate art-style exception.",
    "",
    "JSON shape:",
    '{ "scenes": [ { "index": 1, "beat": "hook", "start": 0, "end": 4, "asset_type": "still", "gap_type": "new_fact", "gap_state": "opens", "render": { "era": "prehistoric", "location": "inside a firelit cave", "subject_type": "period_people", "style": "channel_default" }, "visual_prompt": "...", "on_screen_text": "...", "narration": "..." } ] }',
    "",
    `channel: ${channel}`,
    `title: ${title}`,
    `entity: ${entity}`,
    `situation: ${situation}`,
    "",
    "SCRIPT:",
    scriptText,
  ].join("\n");
}

// Call Ollama and return the parsed scene object. Throws on any transport,
// HTTP, or JSON-parse failure so the caller can retry-once-then-alert rather
// than proceeding on bad output (Section 03 step 6 discipline).
async function toSceneJson({ title, entity, situation, channel, scriptText }) {
  const body = {
    model: MODEL,
    prompt: buildPrompt({ title, entity, situation, channel, scriptText }),
    format: "json",
    stream: false,
    options: { temperature: 0.2 },
  };

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama request failed (is 'ollama serve' running on 11434?): ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (!payload.response) throw new Error("Ollama returned an empty response field");

  let parsed;
  try {
    parsed = JSON.parse(payload.response);
  } catch (err) {
    throw new Error(`qwen did not return valid JSON: ${err.message}`);
  }
  return parsed;
}

// Regenerate ONE scene's visual_prompt in isolation (used by the deterministic
// vpcheck repair loop). Given the scene's own narration, an explicit "avoid this"
// instruction (the specific clause/keyword that failed the audit), and the other
// scenes' prompts to stay distinct from, return a single fresh visual_prompt
// string. Kept deliberately narrow: it edits nothing else on the scene. Throws on
// transport/HTTP/JSON failure so the caller can fall through to a qa_flag rather
// than trusting a bad regen.
async function regenerateVisualPrompt({ scene, avoid, otherPrompts = [], channel, entity, situation }) {
  const others = (otherPrompts || []).map((p, i) => `  ${i + 1}. ${p}`).join("\n");
  const prompt = [
    "You rewrite ONE image-generation prompt (visual_prompt) for a single video scene.",
    "Output ONLY valid JSON of the exact shape: { \"visual_prompt\": \"...\" }. No prose.",
    "",
    "The visual_prompt is a concrete, filmable SHOT DESCRIPTION for an image model. It MUST specify:",
    "  (a) FRAMING / ANGLE (e.g. wide establishing shot, low-angle close-up, overhead/top-down, over-the-shoulder).",
    "  (b) SUBJECT COUNT (e.g. a single figure, two figures, a small group of five).",
    "  (c) A SPECIFIC VISIBLE ACTION happening now (something you could photograph), NOT an internal state.",
    "  (d) LIGHTING INTENT where relevant (e.g. firelight from below, pale moonlight).",
    "HARD RULE: describe ONLY what a camera can see. No sounds, no silence, no temperature, no smell, no emotion.",
    "HARD RULE: this prompt must be clearly DISTINCT from every other scene's prompt below — different action, focus, and composition.",
    "",
    `AVOID (this is why the previous version was rejected): ${avoid}`,
    "",
    "Other scenes' visual_prompts (yours must NOT resemble any of these):",
    others || "  (none)",
    "",
    channel ? `channel: ${channel}` : "",
    entity ? `entity: ${entity}` : "",
    situation ? `situation: ${situation}` : "",
    "",
    "This scene's narration (write a shot that depicts it):",
    scene && scene.narration ? scene.narration : "",
  ].filter((l) => l !== "").join("\n");

  const body = {
    model: MODEL,
    prompt,
    format: "json",
    stream: false,
    // Slightly warmer than the main pass so the retry actually diverges from the
    // rejected version instead of reproducing it.
    options: { temperature: 0.6 },
  };

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama request failed (is 'ollama serve' running on 11434?): ${err.message}`);
  }
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);

  const payload = await res.json();
  if (!payload.response) throw new Error("Ollama returned an empty response field");
  let parsed;
  try {
    parsed = JSON.parse(payload.response);
  } catch (err) {
    throw new Error(`qwen did not return valid JSON: ${err.message}`);
  }
  if (typeof parsed.visual_prompt !== "string" || !parsed.visual_prompt.trim()) {
    throw new Error("qwen regen did not return a non-empty visual_prompt");
  }
  return parsed.visual_prompt.trim();
}

// Shot-prompt pass (stage 6). Given ONE shot window's exact aligned narration
// text plus its immediate neighbours (for distinctness + context), write one
// concrete stick-figure visual_prompt depicting THAT shot. Timing is already
// fixed by shots.js; this only decides what each shot depicts. Same discipline as
// the main pass and the repair primitive: framing + subject count + one visible
// action + lighting, and never a sound/silence/temperature/emotion cue. Throws on
// transport/HTTP/JSON failure so the caller can retry or fall through to a flag.
async function generateShotPrompt({ shotText, prevText, nextText, channel, entity, situation }) {
  const prompt = [
    "You write ONE image-generation prompt (visual_prompt) for a single ~3-second video shot.",
    'Output ONLY valid JSON of the exact shape: { "visual_prompt": "..." }. No prose.',
    "",
    "The visual_prompt is a concrete, filmable SHOT DESCRIPTION for a stick-figure image. It MUST specify:",
    "  (a) FRAMING / ANGLE (e.g. wide establishing shot, low-angle close-up, overhead/top-down, over-the-shoulder, side profile).",
    "  (b) SUBJECT COUNT (e.g. a single figure, two figures, a small group of five).",
    "  (c) ONE SPECIFIC VISIBLE ACTION happening now (something you could photograph), NOT an internal state.",
    "  (d) LIGHTING INTENT where relevant (e.g. firelight from below, pale moonlight, dawn backlight).",
    "HARD RULE: describe ONLY what a camera can see. No sounds, no silence, no temperature, no smell, no emotion, no music/rhythm — an image cannot show those.",
    "HARD RULE: depict THIS shot's line specifically, and make it visibly DISTINCT from the neighbouring shots below (different action, focus, and composition) — never a restatement of a neighbour.",
    "",
    channel ? `channel: ${channel}` : "",
    entity ? `entity: ${entity}` : "",
    situation ? `situation: ${situation}` : "",
    "",
    prevText ? `PREVIOUS shot said (do not repeat its imagery): ${prevText}` : "",
    `THIS shot says (depict this): ${shotText}`,
    nextText ? `NEXT shot will say (leave it for that shot, do not depict it): ${nextText}` : "",
  ].filter((l) => l !== "").join("\n");

  const body = {
    model: MODEL,
    prompt,
    format: "json",
    stream: false,
    // A little warmth so 200 sibling shots do not collapse into a template.
    options: { temperature: 0.5 },
  };

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama request failed (is 'ollama serve' running on 11434?): ${err.message}`);
  }
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const payload = await res.json();
  if (!payload.response) throw new Error("Ollama returned an empty response field");
  let parsed;
  try {
    parsed = JSON.parse(payload.response);
  } catch (err) {
    throw new Error(`qwen did not return valid JSON: ${err.message}`);
  }
  if (typeof parsed.visual_prompt !== "string" || !parsed.visual_prompt.trim()) {
    throw new Error("qwen shot-prompt did not return a non-empty visual_prompt");
  }
  return parsed.visual_prompt.trim();
}

// Data-visual shot-prompt pass (stage 6, data_visual branch). For a shot whose
// beat carries render.subject_type === "data_visual", write a stylized data
// graphic prompt in the channel's SAME flat 2D minimalist style, from a fixed
// layout vocabulary, with an on-screen label capped at 1-3 words. Returns
// { visual_prompt, layout, topic, label } so the orchestrator can key its
// per-run grammar registry (topic -> layout) and reuse layouts when a later
// shot revisits the same data point. Pass `reuse` ({ topic, layout,
// visual_prompt }) to force the earlier graphic's layout/structure. Throws on
// transport/HTTP/JSON failure or an out-of-vocabulary result so the caller can
// retry-once-then-alert rather than shipping a malformed graphic prompt.
const DATA_VISUAL_LAYOUTS = ["timeline_bar", "radius_diagram", "donut_chart", "line_graph", "icon_count"];

async function generateDataVisualPrompt({ shotText, channel, entity, situation, reuse }) {
  const reuseBlock = reuse
    ? [
        "LAYOUT REUSE (MANDATORY): this shot revisits a data point already shown earlier in the video.",
        `Earlier topic: ${reuse.topic}. Earlier layout: ${reuse.layout}.`,
        `Earlier graphic prompt (match its layout and structure, changing ONLY the value/highlighted portion and label): ${reuse.visual_prompt}`,
        `You MUST set "layout" to "${reuse.layout}" and describe the SAME graphic structure, not a new chart style.`,
      ].join("\n")
    : "";
  const prompt = [
    "You write ONE image-generation prompt (visual_prompt) for a single ~3-second DATA GRAPHIC shot in a video.",
    'Output ONLY valid JSON of the exact shape: { "visual_prompt": "...", "layout": "...", "topic": "...", "label": "..." }. No prose.',
    "",
    "The shot is a stylized data/explainer graphic in the SAME flat 2D minimalist vector style as the video's stick-figure scenes. It is NOT a separate infographic style: no gradients, no 3D, no gridlines, no dense annotation, no chart-software look.",
    "Requirements:",
    `  - layout: exactly one of: ${DATA_VISUAL_LAYOUTS.join(", ")}. Pick the layout that most directly shows the shot's ONE quantity.`,
    "  - The graphic shows EXACTLY ONE quantity (a duration, distance, proportion, count, or trend) taken from this shot's narration. Never two quantities, never a legend.",
    "  - label: the ONLY on-screen text, 1 to 3 words MAXIMUM, near-instantly readable (e.g. \"9 hours\", \"half the night\"). All explanation lives in the narration, never on screen.",
    "  - topic: a short 1-4 word name for the underlying data point (e.g. \"sleep duration\"), stable enough that a later revisit of the same fact would name it the same way.",
    "  - visual_prompt: describe the graphic concretely: the layout, the single quantity it shows, where the label sits, and the color semantics below. No camera framing language, no characters unless a tiny simplified figure is integral to the diagram (e.g. a figure at the center of a radius diagram).",
    "COLOR SEMANTICS (fixed, not decorative): dark baseline tone for the unknown or natural state; neutral light tone for the established fact; ONE reserved accent color used ONLY for the portion representing human intervention, change, or something gained/lost. Nothing else may use the accent.",
    "HARD RULE: describe ONLY what can be seen. No sounds, no silence, no temperature, no smell, no emotion.",
    "",
    reuseBlock,
    channel ? `channel: ${channel}` : "",
    entity ? `entity: ${entity}` : "",
    situation ? `situation: ${situation}` : "",
    "",
    `THIS shot's narration (its one quantity is what the graphic shows): ${shotText}`,
  ].filter((l) => l !== "").join("\n");

  const body = {
    model: MODEL,
    prompt,
    format: "json",
    stream: false,
    options: { temperature: 0.4 },
  };

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Ollama request failed (is 'ollama serve' running on 11434?): ${err.message}`);
  }
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const payload = await res.json();
  if (!payload.response) throw new Error("Ollama returned an empty response field");
  let parsed;
  try {
    parsed = JSON.parse(payload.response);
  } catch (err) {
    throw new Error(`qwen did not return valid JSON: ${err.message}`);
  }
  // Fail-fast validation at the boundary: qwen output is never trusted.
  if (typeof parsed.visual_prompt !== "string" || !parsed.visual_prompt.trim()) {
    throw new Error("qwen data-visual prompt is empty");
  }
  if (!DATA_VISUAL_LAYOUTS.includes(parsed.layout)) {
    throw new Error(`qwen data-visual layout "${parsed.layout}" is not one of ${DATA_VISUAL_LAYOUTS.join(", ")}`);
  }
  if (reuse && parsed.layout !== reuse.layout) {
    throw new Error(`qwen data-visual ignored layout reuse (wanted "${reuse.layout}", got "${parsed.layout}")`);
  }
  if (typeof parsed.topic !== "string" || !parsed.topic.trim()) {
    throw new Error("qwen data-visual topic is empty");
  }
  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  if (!label || label.split(/\s+/).length > 3) {
    throw new Error(`qwen data-visual label must be 1-3 words (got "${parsed.label}")`);
  }
  return {
    visual_prompt: parsed.visual_prompt.trim(),
    layout: parsed.layout,
    topic: parsed.topic.trim(),
    label,
  };
}

module.exports = {
  toSceneJson,
  regenerateVisualPrompt,
  generateShotPrompt,
  generateDataVisualPrompt,
  DATA_VISUAL_LAYOUTS,
  MODEL,
};

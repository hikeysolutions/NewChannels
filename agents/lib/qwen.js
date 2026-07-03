"use strict";

// Stage 2 of the two-stage model: the local qwen2.5:7b model on Ollama turns
// the prose script into scene JSON with timestamps. This is the JSON step, kept
// on the local model per the OpenClaw rule "Never use Gemini for JSON - use
// qwen2.5:7b Ollama". Zero marginal cost, no network beyond localhost.

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";

function buildPrompt({ title, entity, situation, channel, scriptText }) {
  return [
    "You convert a narration script into a scene manifest. Output ONLY valid JSON, no prose.",
    "",
    "Rules:",
    "- Split the script into ordered scenes, one scene per beat or natural narration chunk.",
    "- Give each scene a start and end time in whole seconds. Scenes are contiguous: scene[n].start == scene[n-1].end. First scene starts at 0.",
    "- Estimate duration from narration length at roughly 2.5 words per second.",
    "- Mark exactly 1 or 2 scenes as asset_type \"hero\" (the most visually dramatic moments). All other scenes are asset_type \"still\".",
    "- visual_prompt: a short image/video generation prompt describing what is on screen for that scene.",
    "- on_screen_text: a short caption for the scene, or an empty string if none.",
    "- narration: the exact narration text for that scene, copied from the script.",
    "",
    "JSON shape:",
    '{ "scenes": [ { "index": 1, "beat": "hook", "start": 0, "end": 4, "asset_type": "still", "visual_prompt": "...", "on_screen_text": "...", "narration": "..." } ] }',
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

module.exports = { toSceneJson, MODEL };

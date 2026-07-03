"use strict";

// Stage 1 of the two-stage model: prose script generation.
// Groq primary, Cerebras fallback - the standing cross-business provider order
// (Scripts/lib/ai-providers.js "creative" tier). Endpoints, models, and fallback
// logic mirror that shared library verbatim; this file keeps a local copy so the
// NewChannels repo stays free of cross-build dependencies (Section 00).
//
// Stage 2 (scene JSON) stays on local qwen2.5:7b - see qwen.js.

// Recommended replacement for the deprecated llama-3.3-70b-versatile (Groq
// decommission 2026-08-16). Matches the creative tier already in use elsewhere.
const GROQ_MODEL = "openai/gpt-oss-120b";
const CEREBRAS_MODEL = "gpt-oss-120b";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";

// One OpenAI-compatible chat call. Returns the content string, or null on any
// failure so the caller can fall through to the next provider.
async function callChat(url, apiKey, model, systemPrompt, userPrompt, maxTokens, temperature) {
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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      process.stderr.write(`[warn] ${url} HTTP ${res.status}: ${detail.slice(0, 300)}\n`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? content.trim() : null;
  } catch (err) {
    process.stderr.write(`[warn] ${url} request failed: ${err.message}\n`);
    return null;
  }
}

function buildSystemPrompt(channel, styleGuide) {
  return [
    `You are the script writer for a YouTube automation pipeline, channel "${channel}".`,
    "Follow the channel style guide below exactly: its format, its beat structure, and its title formula.",
    "Write a single narration script a voice actor can read start to finish. No stage directions, no shot lists, no JSON.",
    "Every video must be genuinely written for its specific subject, never a find-and-replace of a template (YouTube mass-content policy).",
    "Do not invent confident-sounding but unsupported historical facts. If a specific detail is not well established, keep the claim general.",
    "Write like a human. Vary sentence length. No em dashes, no filler, no AI throat-clearing.",
    "",
    "First line of your reply MUST be exactly: TITLE: <the video title, built from the style guide title formula>",
    "Then a blank line, then the narration script itself, organized into the style guide's beats with a short bold beat label before each beat.",
    "",
    "=== CHANNEL STYLE GUIDE ===",
    styleGuide,
  ].join("\n");
}

// Generate the prose script: Groq first, Cerebras on failure. Throws only if
// both providers fail. Returns { title, scriptText, provider, raw }.
async function generateScript({ groqKey, cerebrasKey, channel, styleGuide, entity, situation }) {
  const systemPrompt = buildSystemPrompt(channel, styleGuide);
  const userPrompt = [
    `Entity: ${entity}`,
    `Situation: ${situation}`,
    "",
    "Write the script for this exact entity and situation now.",
  ].join("\n");

  // Groq free on_demand tier caps at 8000 TPM, counting input + reserved
  // max_tokens together. Cap the reservation below that so a normal script
  // request fits (input ~750 + 7000 = ~7750 < 8000). ~72s of narration is only
  // ~1500-2000 output tokens, so this is still ample headroom.
  const maxTokens = 7000;
  const temperature = 0.7;

  let provider = "groq";
  let raw = await callChat(GROQ_URL, groqKey, GROQ_MODEL, systemPrompt, userPrompt, maxTokens, temperature);

  if (raw === null) {
    process.stderr.write("[warn] Groq failed, falling back to Cerebras\n");
    provider = "cerebras";
    raw = await callChat(CEREBRAS_URL, cerebrasKey, CEREBRAS_MODEL, systemPrompt, userPrompt, maxTokens, temperature);
  }

  if (raw === null) {
    throw new Error("both Groq and Cerebras failed (check GROQ_API_KEY / CEREBRAS_API_KEY in ~/.openclaw/.env)");
  }

  const match = raw.match(/^TITLE:\s*(.+)$/m);
  if (!match) throw new Error(`${provider} reply missing required 'TITLE:' line`);
  const title = match[1].trim();
  const scriptText = raw.slice(raw.indexOf("\n", match.index) + 1).trim();

  return { title, scriptText, provider, raw };
}

module.exports = { generateScript, GROQ_MODEL, CEREBRAS_MODEL };

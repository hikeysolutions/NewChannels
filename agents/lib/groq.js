"use strict";

// Stage 1 of the two-stage model: prose script generation.
// Groq primary, Cerebras fallback - the standing cross-business provider order
// (Scripts/lib/ai-providers.js "creative" tier). Endpoints, models, and fallback
// logic mirror that shared library verbatim; this file keeps a local copy so the
// NewChannels repo stays free of cross-build dependencies (Section 00).
//
// Stage 2 (scene JSON) stays on local qwen2.5:7b - see qwen.js.

const { personaFor } = require("./personas");

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
  // Persona (Section 06) is the voice identity and comes first: the STYLE GUIDE
  // governs FORMAT (beats, title formula), the persona governs VOICE. When they
  // seem to conflict, the persona's own "prioritize retention pacing over
  // stylistic purity" rule (in the block) resolves it.
  const persona = personaFor(channel);
  return [
    `You are the narrator-script writer for a YouTube automation pipeline, channel "${channel}".`,
    "You write in a specific, fixed narrator voice. That voice is defined in the NARRATOR PERSONA below and is NOT optional: it governs word choice, framing, and worldview in every line.",
    "",
    "=== NARRATOR PERSONA (voice identity — follow exactly, never state or explain it) ===",
    persona,
    "",
    "=== HOW TO WRITE ===",
    "Follow the channel style guide below for FORMAT: its beat structure and its title formula. Follow the persona above for VOICE.",
    "Write a single narration script a voice actor can read start to finish. No stage directions, no shot lists, no JSON.",
    "Every video must be genuinely written for its specific subject, never a find-and-replace of a template (YouTube mass-content policy).",
    "Do not invent confident-sounding but unsupported historical facts. If a specific detail is not well established, keep the claim general.",
    "Write like a human. Vary sentence length. No em dashes, no filler, no AI throat-clearing.",
    "Do not use any of the persona's Forbidden Shortcuts anywhere, including the opening line.",
    "",
    "=== GAP DYNAMICS (narrative arc — this governs retention, follow it) ===",
    "The script is a chain of overlapping curiosity gaps, not a flat pile of facts. A gap is a question or tension the viewer now wants answered. Open gaps early, then PAY THEM OFF as you go: a beat that partly answers an earlier question while raising a fresh one keeps tension rolling forward instead of stacking unanswered.",
    "The style guide's beats are LOCKED, so work the gap arc INSIDE them — do not just open, open, open through the whole first half and save every answer for the reveal. Map it to the beats like this:",
    "  - Hook: open the core question.",
    "  - Context / setup: while you set the scene, ANSWER one small concrete sub-question you can settle right here (a specific who/when/how detail). Do not leave this beat purely opening more threads.",
    "  - Rising / middle: pay off PART of the core question — reveal a genuine partial answer — before pushing to the next tension. This partial payoff must land here, not be deferred to the reveal.",
    "  - Hidden-detail reveal: deliver the surprising specific (this both answers and re-hooks).",
    "  - Emotional payoff: CLOSE the core question with a real resolution. The final lines must land an answer, never trail off on one more brand-new fact left hanging.",
    "Rule of thumb: after the setup beat, the viewer should already have gotten at least one straight answer, and no stretch should spend more than a couple of beats only raising questions without settling something earlier.",
    "Do not label or announce any of this. It shows up purely in what the narration actually does: open, settle a small thing, partly resolve, reveal, resolve.",
    "",
    "First line of your reply MUST be exactly: TITLE: <the video title, built from the style guide title formula>",
    "Then a blank line, then the narration script itself, organized into the style guide's beats with a short bold beat label before each beat.",
    "",
    "=== CHANNEL STYLE GUIDE (format only) ===",
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
  // max_tokens together. The system prompt now carries the Section 06 persona
  // block (~600 tokens) on top of the style guide, so input runs ~1300-1400
  // tokens. Keep the reservation low enough that input + reservation stays under
  // 8000 (1400 + 6000 = 7400 < 8000). ~72s of narration is only ~1500-2000
  // output tokens, so 6000 is still ample headroom.
  const maxTokens = 6000;
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

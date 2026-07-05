"use strict";

// Stage 1 of the two-stage model: prose script generation.
// Groq primary, Cerebras fallback - the standing cross-business provider order
// (Scripts/lib/ai-providers.js "creative" tier). Endpoints, models, and fallback
// logic mirror that shared library verbatim; this file keeps a local copy so the
// NewChannels repo stays free of cross-build dependencies (Section 00).
//
// Stage 2 (scene JSON) stays on local qwen2.5:7b - see qwen.js.

const { personaFor } = require("./personas");
const { resolveChain } = require("./llm_registry");

// Provider endpoints, models, auth vars, and the fallback ORDER now live in
// config/llm-models.json + ChannelX/config.json, resolved by llm_registry.js.
// Adding, removing, or reordering providers is a config edit, not a change here.

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
    "=== STORY LADDER (narrative craft — layered on the gap arc, not a replacement) ===",
    "The gap arc governs WHEN tension opens and closes; these four rules govern HOW each beat is built. Follow all four. Never state or label them; they show only in what the narration does.",
    "1. MISDIRECTION, not just new facts. At least one beat names a belief the viewer already holds, then flatly inverts it: 'you assume X; you're wrong, it's actually Y.' A genuine rug-pull, stronger than merely contradicting an earlier line.",
    "2. NESTED LOOPS per topic. Each fact-cluster closes its own loop before the next opens: claim (WHAT), reason/mechanism (WHY), concrete case (EXAMPLE), meaning (TAKEAWAY). Never jump to a new topic with the current one half-explained, even as the larger gap chain keeps building.",
    "3. EARLY PERSONAL STAKES. In the first two beats, make it land that this is about the viewer's own body, behavior, or life right now, not an abstract fact about the entity. Ground it in something they experience today.",
    "4. NO TACTICAL CLOSER. The final beat must not resolve into advice or a tidy 'here's what to do.' End on an open, resonant, slightly haunting image that leaves something unresolved (matching the persona's high permitted ambiguity).",
    "",
    "=== DELIVERY & PACING (retention mechanics — layered on the above, all checkable) ===",
    "1. SPEED TO VALUE. Within the first 5 seconds of narration (the first line or two), explicitly signal the specific payoff coming. Not just that this touches the viewer's own life (the Story Ladder's personal-stakes rule already covers that), but a real promise of what is about to be revealed. If the full reveal cannot land that early, the opening line must still make clear that something surprising is coming and roughly what domain it sits in.",
    "2. VALUE DENSITY. Every sentence must do one of three jobs: advance the gap chain, deliver a concrete detail, or set up the next beat. Cut any sentence that only transitions, restates, or sets a scene without adding new information.",
    "3. REPEATERS. For the 1 or 2 most load-bearing claims ONLY, never every claim, state the point twice: first concisely with the proper term, then again in plainer words with a concrete example or comparison. Reserve this for the script's core payoff; ordinary claims are stated once.",
    "",
    "=== QUANTITATIVE ANCHORS (data moments — checkable rules) ===",
    "Anchor claims in concrete numbers or comparisons (a duration, a distance, a proportion, a count, a trend), each written as its own short standalone sentence or two. These become brief data visuals downstream, punctuating the character-driven narrative.",
    "Rules, all checkable:",
    "  - Include 2 or 3 quantitative anchors per script — REQUIRED, not optional. Well-established quantities only (e.g. hours of darkness, sleep segments, distances, group sizes), consistent with the no-invented-facts rule above.",
    "  - A quantitative anchor is at most two sentences and carries exactly one quantity.",
    "  - Never place two quantitative anchors back to back; character-driven narration must sit between them.",
    "  - Do NOT put them on a fixed schedule. Place each where its number genuinely lands the point, spread out across the script, never clustered.",
    "  - When a later beat revisits or validates an earlier number with new evidence, state it in the SAME quantitative form as before (same unit, same comparison shape) so the visual can reuse the earlier graphic rather than inventing a new one.",
    "",
    "First line of your reply MUST be exactly: TITLE: <the video title, built from the style guide title formula>",
    "Then a blank line, then the narration script itself, organized into the style guide's beats with a short bold beat label before each beat.",
    "",
    "=== CHANNEL STYLE GUIDE (format only) ===",
    styleGuide,
  ].join("\n");
}

// Generate the prose script by walking the channel's resolved provider chain
// (config/llm-models.json order, Groq then Cerebras by default). Each provider's
// endpoint, model, max_tokens, temperature, and auth come from the registry; the
// first one that returns content wins. Throws only if every provider fails.
// Returns { title, scriptText, provider, raw }.
//
// max_tokens note (lives on the Groq registry entry): the free on_demand tier
// caps at 8000 TPM counting input + reserved max_tokens together. The system
// prompt (persona + gap-dynamics + Story Ladder + DELIVERY & PACING +
// quantitative-anchor blocks + style guide) runs ~3000 tokens; a 5500 reservation
// once requested 8197 and 413'd every call. The DELIVERY & PACING block later
// pushed a real request to 7796/8000 at a 4800 reservation (only ~200 headroom),
// so the reservation was cut to 4500 (~7500 total, ~500 headroom) — still 2x+ the
// ~1500-2000-token narration output. A 413 fails SOFT (falls through to the next
// provider), so watch the [warn] 413 line after any prompt/style-guide edit and
// re-measure if it grows. (A 429 with "Requested <8000" is a per-minute rate
// limit from rapid successive calls, NOT the single-request 413 ceiling.)
async function generateScript({ env, channel, styleGuide, entity, situation }) {
  const systemPrompt = buildSystemPrompt(channel, styleGuide);
  const userPrompt = [
    `Entity: ${entity}`,
    `Situation: ${situation}`,
    "",
    "Write the script for this exact entity and situation now.",
  ].join("\n");

  const chain = resolveChain(channel, env || {});
  if (!chain.length) throw new Error(`no llm providers configured for channel '${channel}'`);

  let provider = null;
  let raw = null;
  let attempted = false;
  for (const p of chain) {
    if (!p.apiKey) continue; // unconfigured provider — skip to the next
    if (attempted) process.stderr.write(`[warn] falling back to ${p.id}\n`);
    attempted = true;
    provider = p.id;
    raw = await callChat(
      p.endpoint,
      p.apiKey,
      p.model,
      systemPrompt,
      userPrompt,
      p.max_tokens,
      p.temperature,
    );
    if (raw !== null) break;
  }

  if (raw === null) {
    const names = chain.map((p) => p.id).join(" / ");
    throw new Error(`all script providers failed (${names}) — check auth keys in ~/.openclaw/.env`);
  }

  const match = raw.match(/^TITLE:\s*(.+)$/m);
  if (!match) throw new Error(`${provider} reply missing required 'TITLE:' line`);
  const title = match[1].trim();
  const scriptText = raw.slice(raw.indexOf("\n", match.index) + 1).trim();

  return { title, scriptText, provider, raw };
}

module.exports = { generateScript };

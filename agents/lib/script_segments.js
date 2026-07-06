"use strict";

// Deterministic script segmentation for Stage 2 (scene JSON).
//
// The scene-JSON model no longer re-emits narration text (it dropped/abridged
// whole sentences when asked to). Instead it assigns each scene a contiguous
// range of SENTENCE NUMBERS, and this module owns the actual text: it derives the
// canonical narration from the raw script, splits it into numbered sentences
// LOSSLESSLY (the segments rejoin to exactly the canonical text), and lets the
// caller reconstruct each scene's narration by slicing. That guarantees 100%
// verbatim coverage by construction — the model only decides boundaries.

// The canonical narration is the script as the narrator actually speaks it: the
// prose with the Stage-1 formatting stripped (the "# Title" heading and the bold
// **Beat Label** markers), and whitespace collapsed to single spaces. This is the
// single reference text that every scene's narration must, concatenated, equal.
function toCanonicalNarration(scriptText) {
  return String(scriptText || "")
    .replace(/^#.*$/gm, " ") // markdown headings (e.g. a stray "# Title")
    .replace(/\*\*[^*]+\*\*/g, " ") // **Beat Label** markers
    .replace(/\s+/g, " ")
    .trim();
}

// Split text into sentences WITHOUT losing a single character:
// splitSentences(t).join("") === t exactly. Each segment ends at sentence-final
// punctuation (plus any trailing quotes/brackets and whitespace); the final tail
// is captured even when it has no terminal punctuation. Segmentation quality does
// not affect coverage — losslessness does — so a missed abbreviation boundary is
// harmless.
function splitSentences(text) {
  const src = String(text || "");
  const segments = [];
  const re = /[.!?]+["'”’)\]]*(?:\s+|$)/g;
  let start = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = re.lastIndex;
    segments.push(src.slice(start, end));
    start = end;
  }
  if (start < src.length) segments.push(src.slice(start));
  return segments.filter((s) => s.length > 0);
}

// Whitespace-insensitive comparison key. Two texts are equal-for-coverage when
// their non-whitespace content matches, so per-scene trimming/rejoining can never
// register as a coverage gap.
function normalizeForCompare(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

module.exports = { toCanonicalNarration, splitSentences, normalizeForCompare };

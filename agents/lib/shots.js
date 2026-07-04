"use strict";

// Shot segmentation (stage 6). Turns per-beat word timestamps (from flyt-align.py)
// into shot windows that each get their own still. Cuts are CONTENT-DRIVEN, not on
// a fixed clock: a shot accumulates words until it reaches the target length AND
// hits a clause boundary (punctuation), falling back to a hard split only when a
// clause runs past the max. Timing here decides WHERE to cut; a later qwen pass
// decides WHAT each still depicts.
//
// Cadence target is ~2.5-3s (Zenn's stated range). Tunable via opts.

const SHOT_TARGET = 2.75; // center of the 2.5-3s band; shot count is derived from this
const SHOT_MAX = 3.5;     // used only for the over-cadence assertion in tests
const SHOT_MIN = 1.8;

// A word token ends a clause if its trailing text is sentence/clause punctuation.
// The aligned tokens carry punctuation (e.g. "night?", "sleep,"), so we test the
// last character of the token.
const CLAUSE_PUNCT = new Set([".", ",", ";", ":", "?", "!", "—"]);
function endsClause(token) {
  const t = (token || "").trim();
  return t.length > 0 && CLAUSE_PUNCT.has(t[t.length - 1]);
}

// Segment ONE beat into shot windows that CONTIGUOUSLY tile [0, audioDur] (so the
// stills cover the whole beat's narration wav with no silent gaps). Derive an even
// shot count from the target, then snap each evenly-spaced cut to the nearest word
// boundary, PREFERRING a clause boundary within reach — so shots stay in the target
// band while cutting on content (clause) edges where possible.
function segmentBeat(words, audioDur, target) {
  const allText = (ws) => ws.map((w) => w.word).join(" ").replace(/\s+/g, " ").trim();
  if (!words || words.length === 0) {
    return [{ start: 0, end: round(audioDur), duration: round(audioDur), text: "" }];
  }

  const nShots = Math.max(1, Math.round(audioDur / target));
  if (nShots === 1) {
    return [{ start: 0, end: round(audioDur), duration: round(audioDur), text: allText(words) }];
  }

  // Snap each of the (nShots-1) evenly-spaced ideal cut times to a word.end,
  // discounting clause-ending words so a nearby clause boundary wins over a
  // marginally-closer mid-clause word. `prev` keeps cuts strictly increasing.
  const clauseBonus = target * 0.18; // gentle: prefer a nearby clause edge, don't drag cuts far off-cadence
  const cuts = [];
  let prev = 0;
  for (let k = 1; k < nShots; k += 1) {
    const ideal = (audioDur * k) / nShots;
    let best = null;
    let bestScore = Infinity;
    for (const w of words) {
      const t = w.end;
      if (t <= prev + 0.1 || t >= audioDur - 0.1) continue;
      let score = Math.abs(t - ideal);
      if (endsClause(w.word)) score -= clauseBonus;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best != null) { cuts.push(round(best)); prev = best; }
  }

  const bounds = [0, ...cuts, round(audioDur)];
  const windows = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const text = allText(words.filter((w) => w.start >= start && w.start < end));
    windows.push({ start: round(start), end: round(end), duration: round(end - start), text });
  }
  return windows;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// Segment all beats. `alignBeats` is the align.json `beats` array
// ([{index, words:[{word,start,end}]}]). Returns a flat, globally-indexed shot
// list: [{beat_index, shot_index, start, end, duration, text}] where start/end
// are beat-relative (same frame as the beat's narration wav).
function segmentShots(alignBeats, opts = {}) {
  const target = opts.target ?? SHOT_TARGET;

  const out = [];
  let shotIndex = 0;
  for (const beat of alignBeats) {
    // Tile the beat's full wav duration so stills cover trailing silence too;
    // fall back to the last aligned word if the duration field is missing.
    const audioDur = beat.audio_duration_seconds
      ?? (beat.words && beat.words.length ? beat.words[beat.words.length - 1].end : 0);
    const beatShots = segmentBeat(beat.words, audioDur, target);
    for (const s of beatShots) {
      out.push({
        beat_index: beat.index,
        shot_index: shotIndex,
        start: s.start,
        end: s.end,
        duration: s.duration,
        text: s.text,
      });
      shotIndex += 1;
    }
  }
  return out;
}

module.exports = { segmentShots, segmentBeat, SHOT_TARGET, SHOT_MAX, SHOT_MIN };

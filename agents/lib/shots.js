"use strict";

// Shot segmentation (stage 6). Turns per-beat word timestamps (from flyt-align.py)
// into shot windows that each get their own still. Cuts are CONTENT-DRIVEN: shots
// are built BOTTOM-UP from clause/phrase boundaries in the real word-level
// alignment, NOT sliced on a fixed clock. A shot is one or more whole clauses; the
// cadence target only decides how many small clauses to group together, and the max
// only forces an internal split when a single clause runs long. Every cut lands on a
// real clause boundary unless a clause is longer than SHOT_MAX on its own — and even
// then the internal split prefers a sub-phrase connective ("and", "with", "as"...)
// where a new descriptive unit begins. Timing here decides WHERE to cut; a later
// qwen pass decides WHAT each still depicts.
//
// Cadence band is ~2.5-3s (Zenn's stated range), but a short clause is allowed to
// run under 2s and a rich descriptive phrase over 3s — the content sets the length.

const SHOT_TARGET = 2.75; // preferred group length when packing small clauses
const SHOT_MAX = 4.2;     // a shot longer than this is split internally
const SHOT_MIN = 1.6;     // a group shorter than this keeps absorbing the next clause

// A word token ends a clause if its trailing text is sentence/clause punctuation.
// The aligned tokens carry punctuation (e.g. "night?", "sleep,"), so we test the
// last character of the token.
const CLAUSE_PUNCT = new Set([".", ",", ";", ":", "?", "!", "—"]);
function endsClause(token) {
  const t = (token || "").trim();
  return t.length > 0 && CLAUSE_PUNCT.has(t[t.length - 1]);
}

// Words that typically OPEN a new descriptive unit (a new subject, action, or scene
// element). When a long clause must be split, we prefer to cut right BEFORE one of
// these so the new shot starts on the new thing being described.
const BOUNDARY_WORDS = new Set([
  "and", "but", "or", "so", "yet", "then", "with", "as", "while", "when", "where",
  "before", "after", "because", "though", "that", "which", "who", "into", "onto",
  "of", "in", "on", "to", "for", "from", "over", "under", "through", "against",
]);
function opensUnit(token) {
  const t = (token || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return BOUNDARY_WORDS.has(t);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// Break a beat's words into clauses at punctuation. Each clause carries its words and
// its real [start, end] from the alignment. A trailing run with no punctuation is its
// own clause.
function toClauses(words) {
  const clauses = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (endsClause(w.word)) {
      clauses.push(cur);
      cur = [];
    }
  }
  if (cur.length) clauses.push(cur);
  return clauses.map((ws) => ({
    words: ws,
    start: ws[0].start,
    end: ws[ws.length - 1].end,
  }));
}

// Split an over-long span (one clause, or a packed group of short clauses whose
// combined length still exceeds SHOT_MAX) into ~ceil(dur/target) sub-windows, cutting
// at word boundaries and PREFERRING a cut right before a BOUNDARY_WORD (new
// descriptive unit) near each evenly-spaced ideal point. Returns internal cut times.
function splitLongClause(span) {
  const { words, start, end } = span;
  const dur = end - start;
  const parts = Math.max(2, Math.round(dur / SHOT_TARGET));
  const cuts = [];
  let prev = start;
  for (let k = 1; k < parts; k += 1) {
    const ideal = start + ((end - start) * k) / parts;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < words.length - 1; i += 1) {
      const t = words[i].end;
      if (t <= prev + 0.4 || t >= end - 0.4) continue;
      let score = Math.abs(t - ideal);
      // strongly prefer a real clause edge inside this window; failing that, cut
      // BEFORE a word that opens a new descriptive unit.
      if (endsClause(words[i].word)) score -= SHOT_TARGET * 1.2;
      else if (opensUnit(words[i + 1].word)) score -= SHOT_TARGET * 0.4;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best != null) { cuts.push(round(best)); prev = best; }
  }
  return cuts;
}

// Segment ONE beat into shot windows that CONTIGUOUSLY tile [0, audioDur]. Build
// clauses from the alignment, greedily pack consecutive clauses toward the target
// cadence (breaking ONLY on clause boundaries), then split any clause that is itself
// longer than SHOT_MAX. The returned cut points are therefore real clause boundaries
// by construction; the clock is only a guardrail.
function segmentBeat(words, audioDur, target) {
  const allText = (ws) => ws.map((w) => w.word).join(" ").replace(/\s+/g, " ").trim();
  if (!words || words.length === 0) {
    return [{ start: 0, end: round(audioDur), duration: round(audioDur), text: "" }];
  }
  const tgt = target ?? SHOT_TARGET;

  const clauses = toClauses(words);

  // Greedy clause packing: grow a group until it reaches the cadence band, only ever
  // closing at a clause edge. A group keeps absorbing clauses while it is below MIN,
  // or while adding the next clause still fits under target; otherwise it closes.
  const groups = [];
  let cur = null;
  for (const c of clauses) {
    if (!cur) { cur = { clauses: [c], start: c.start, end: c.end }; continue; }
    const curDur = cur.end - cur.start;
    const merged = c.end - cur.start;
    const mustGrow = curDur < SHOT_MIN && merged <= SHOT_MAX;
    const roomToTarget = merged <= tgt;
    if (mustGrow || roomToTarget) {
      cur.clauses.push(c);
      cur.end = c.end;
    } else {
      groups.push(cur);
      cur = { clauses: [c], start: c.start, end: c.end };
    }
  }
  if (cur) {
    // absorb a too-short tail group into the previous one
    if (groups.length && cur.end - cur.start < SHOT_MIN) {
      const prev = groups[groups.length - 1];
      prev.clauses.push(...cur.clauses);
      prev.end = cur.end;
    } else {
      groups.push(cur);
    }
  }

  // Primary cut times are the group (clause) boundaries. Build the contiguous
  // [0, audioDur] tiling on those, then a guardrail pass splits any resulting WINDOW
  // longer than SHOT_MAX — this catches both a single over-long clause and a window
  // inflated by a silence gap folded in from contiguous tiling. Splits still land on
  // word/sub-phrase edges, so no cut ever falls inside a spoken word.
  const groupCuts = groups.slice(0, -1).map((g) => round(g.end));
  let bounds = [0, ...groupCuts.filter((t) => t > 0.05 && t < audioDur - 0.05), round(audioDur)];

  const finalBounds = [bounds[0]];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start > SHOT_MAX) {
      const inWin = words.filter((w) => w.end > start && w.end < end);
      const extra = splitLongClause({ words: inWin, start, end });
      for (const c of extra) if (c > start + 0.05 && c < end - 0.05) finalBounds.push(c);
    }
    finalBounds.push(end);
  }
  finalBounds.sort((a, b) => a - b);

  const windows = [];
  for (let i = 0; i < finalBounds.length - 1; i += 1) {
    const start = finalBounds[i];
    const end = finalBounds[i + 1];
    const text = allText(words.filter((w) => w.start >= start && w.start < end));
    windows.push({ start: round(start), end: round(end), duration: round(end - start), text });
  }
  return windows;
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

module.exports = { segmentShots, segmentBeat, endsClause, SHOT_TARGET, SHOT_MAX, SHOT_MIN };

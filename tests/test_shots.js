#!/usr/bin/env node
"use strict";

// Unit test for shot segmentation (lib/shots.js).
//
// This suite exists because of a real, shipped bug: segmentBeat used to derive a
// FIXED shot count from duration and slice cuts on an even clock, only nudging toward
// clauses with a weak bonus — so ~59% of cuts landed mid-phrase (splitting "873 | AD",
// "the pressure of | a looming deadline"). The tests below are written to FAIL LOUDLY
// if that clock-driven behavior ever creeps back in. The core invariant is:
//
//   Every internal cut must land on a REAL clause boundary, unless it falls inside a
//   single clause that is itself longer than SHOT_MAX (which legitimately must be
//   split). A cut mid-clause inside a clause SHORTER than SHOT_MAX is THE bug.

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const {
  segmentBeat, segmentShots, endsClause, SHOT_TARGET, SHOT_MAX, SHOT_MIN,
} = require("../agents/lib/shots");

let pass = 0;
function check(name, fn) { fn(); pass += 1; console.log(`  PASS  ${name}`); }
function round(n) { return Math.round(n * 1000) / 1000; }

// Build an aligned beat from a sentence string. Words are laid out back-to-back at a
// fixed seconds-per-word so clause LENGTHS are predictable; punctuation stays attached
// to the token exactly as flyt-align.py emits it ("war?", "steel,").
function beatFromText(text, secPerWord = 0.35, gapAfter = {}) {
  const toks = text.trim().split(/\s+/);
  const words = [];
  let t = 0;
  toks.forEach((tok, i) => {
    const start = round(t);
    const end = round(t + secPerWord * (0.85 + (tok.replace(/[^a-z]/gi, "").length) / 12));
    words.push({ word: tok, start, end });
    t = end + (gapAfter[i] || 0.0); // optional silence AFTER a given word index
  });
  return { words, audioDur: round(t) };
}

// Real clause-end times of a beat (word.end for every punctuation-terminated token).
function clauseEndTimes(words) {
  return words.filter((w) => endsClause(w.word)).map((w) => round(w.end));
}

// Clause spans [start,end] partitioned at punctuation, covering the whole beat.
function clauseSpans(words) {
  const spans = [];
  let st = words[0].start;
  for (const w of words) {
    if (endsClause(w.word)) { spans.push([st, w.end]); st = w.end; }
  }
  if (st < words[words.length - 1].end) spans.push([st, words[words.length - 1].end]);
  return spans;
}

// Classify every internal cut of a segmentation. Returns counts of cuts that are:
//   onClause  — land exactly on a punctuation clause boundary
//   forced    — mid-clause BUT inside a clause longer than SHOT_MAX (legit split)
//   bug       — mid-clause inside a clause <= SHOT_MAX (the clock-driven defect)
function classifyCuts(words, shots) {
  const ends = clauseEndTimes(words);
  const spans = clauseSpans(words);
  let onClause = 0, forced = 0, bug = 0;
  const bugList = [];
  for (let i = 0; i < shots.length - 1; i += 1) {
    const cut = round(shots[i].end);
    if (ends.some((e) => Math.abs(e - cut) <= 0.06)) { onClause += 1; continue; }
    const span = spans.find(([a, b]) => cut > a + 0.01 && cut < b - 0.01);
    if (span && span[1] - span[0] > SHOT_MAX) { forced += 1; }
    else { bug += 1; bugList.push({ cut, text: shots[i].text }); }
  }
  return { onClause, forced, bug, bugList, total: shots.length - 1 };
}

// Shared invariants every segmentation must hold (assemble.py depends on these).
function assertTiling(beat, shots) {
  assert.ok(shots.length >= 1, "at least one shot");
  assert.strictEqual(shots[0].start, 0, "first shot starts at 0");
  assert.strictEqual(round(shots[shots.length - 1].end), round(beat.audioDur), "last shot ends at audioDur");
  for (let i = 1; i < shots.length; i += 1) {
    assert.ok(Math.abs(shots[i].start - shots[i - 1].end) < 0.002, "contiguous, no gaps/overlaps");
  }
}

// ---------------------------------------------------------------------------
// 1. ONE over-long clause (> SHOT_MAX) among several short clauses. The cut
//    BETWEEN the short clauses must land on the clause boundary; the long clause
//    must be split INTERNALLY (more than one shot for it) — never left as one giant
//    shot, and never cut at a fixed offset that ignores the short-clause boundaries.
// ---------------------------------------------------------------------------
check("over-long clause is split internally; short-clause cuts land on the boundary", () => {
  // clause A ~1.4s, clause B ~1.4s, clause C is a long ~6s descriptive run.
  const { words, audioDur } = beatFromText(
    "Dawn broke, the horns sounded, and the shield wall advanced steadily across the frozen open field toward the waiting enemy line.",
    0.42,
  );
  const beat = { words, audioDur };
  const shots = segmentBeat(words, audioDur, SHOT_TARGET);
  assertTiling(beat, shots);

  const { onClause, bug } = classifyCuts(words, shots);
  // THE core assertion: no cut may land inside a short clause (the clock defect).
  // Short clauses may MERGE toward cadence, but any break between them lands on a
  // real comma/period — never partway through one.
  assert.strictEqual(bug, 0, "zero mid-clause cuts inside short clauses");
  // At least one cut sits on a genuine clause boundary (the short-clause group edge).
  assert.ok(onClause >= 1, "a real clause boundary is used as a cut");
  // The long trailing clause must be split internally, not left as one giant shot.
  assert.ok(shots.length >= 3, `long clause must be split; got only ${shots.length} shots`);
  // No shot exceeds the max guardrail.
  assert.ok(Math.max(...shots.map((s) => s.duration)) <= SHOT_MAX + 0.001, "no shot over SHOT_MAX");
});

// ---------------------------------------------------------------------------
// 2. Several short clauses that should GROUP toward the target cadence. Grouping
//    must only ever break on a clause boundary — a shot must never contain a
//    fraction of one clause plus a fraction of the next (the clock defect).
// ---------------------------------------------------------------------------
check("short clauses group to cadence WITHOUT ever splitting a clause mid-phrase", () => {
  // eight ~0.9s clauses; target grouping should pair them (~1.8s) or so, all on commas.
  const { words, audioDur } = beatFromText(
    "He ran, she hid, they fought, we watched, dogs barked, birds flew, rain fell, night came.",
    0.3,
  );
  const shots = segmentBeat(words, audioDur, SHOT_TARGET);
  assertTiling({ words, audioDur }, shots);

  const { bug } = classifyCuts(words, shots);
  assert.strictEqual(bug, 0, "no cut lands inside a clause — every break is on a comma");

  // EVERY internal cut must coincide with a clause-end time (strict: no clock cuts at
  // all here, because no clause exceeds SHOT_MAX so nothing may be split internally).
  const ends = clauseEndTimes(words);
  for (let i = 0; i < shots.length - 1; i += 1) {
    const cut = round(shots[i].end);
    assert.ok(ends.some((e) => Math.abs(e - cut) <= 0.06), `cut @${cut}s must be a clause boundary`);
  }
  // grouping actually happened (fewer shots than clauses) and stays near cadence.
  assert.ok(shots.length < 8, `clauses should group, got ${shots.length} shots for 8 clauses`);
  const avg = shots.reduce((a, s) => a + s.duration, 0) / shots.length;
  assert.ok(avg >= SHOT_MIN && avg <= SHOT_MAX, `avg ${avg.toFixed(2)}s within [${SHOT_MIN},${SHOT_MAX}]`);
});

// ---------------------------------------------------------------------------
// 3. REAL alignment data (video 11). Reproduces the original 59%-mid-phrase
//    measurement against the NEW segmentBeat and asserts it is near zero. If the
//    align.json is absent (fresh checkout), the check is skipped with a notice.
// ---------------------------------------------------------------------------
check("real video-11 alignment: mid-phrase cut rate is near zero (was 59%)", () => {
  const alignPath = path.join(
    __dirname, "..", "ChannelA", "manifests", "what-did-vikings-do-during-war.align.json",
  );
  if (!fs.existsSync(alignPath)) {
    console.log("     (skipped: video-11 align.json not present in this checkout)");
    return;
  }
  const d = JSON.parse(fs.readFileSync(alignPath, "utf8"));
  let total = 0, bug = 0, onClause = 0, forced = 0;
  for (const beat of d.beats) {
    const words = beat.words;
    if (!words || !words.length) continue;
    const shots = segmentBeat(words, beat.audio_duration_seconds, SHOT_TARGET);
    const c = classifyCuts(words, shots);
    total += c.total; bug += c.bug; onClause += c.onClause; forced += c.forced;
  }
  const bugPct = (100 * bug) / total;
  console.log(`     ${total} cuts: ${onClause} on-clause, ${forced} forced-split(long clause), ${bug} mid-clause bug (${bugPct.toFixed(1)}%)`);
  // Strict gate: the clock-driven defect measured 59% here. Anything above 5% means
  // clock behavior has regressed. Real speech has occasional unavoidable long-run
  // splits, so the bar is <=5%, not literally 0.
  assert.ok(bugPct <= 5.0, `mid-phrase cut rate ${bugPct.toFixed(1)}% exceeds 5% — clock-driven cutting has regressed`);
});

// ---------------------------------------------------------------------------
// Legacy structural invariants (kept from the original suite).
// ---------------------------------------------------------------------------
check("segmentShots: contiguity, full coverage, global index", () => {
  function makeBeat(index, audioDur, nWords) {
    const words = [];
    const step = audioDur / nWords;
    for (let i = 0; i < nWords; i += 1) {
      const clause = (i + 1) % 5 === 0;
      words.push({ word: `w${i}${clause ? "," : ""}`, start: round(i * step), end: round((i + 1) * step - 0.02) });
    }
    return { index, audio_duration_seconds: audioDur, words };
  }
  const beats = [makeBeat(0, 24.0, 90), makeBeat(1, 8.0, 30), makeBeat(2, 3.0, 10)];
  const shots = segmentShots(beats);
  const byBeat = {};
  for (const s of shots) (byBeat[s.beat_index] = byBeat[s.beat_index] || []).push(s);
  for (const beat of beats) {
    const b = byBeat[beat.index] || [];
    for (let i = 1; i < b.length; i += 1) assert.ok(Math.abs(b[i].start - b[i - 1].end) <= 0.001, "contiguous");
    assert.ok(b.length && Math.abs(b[0].start) <= 0.001, "starts at 0");
    assert.ok(Math.abs(b[b.length - 1].end - beat.audio_duration_seconds) <= 0.001, "covers full duration");
  }
  assert.ok(shots.every((s, i) => s.shot_index === i), "global shot_index contiguous");
  assert.ok(Math.max(...shots.map((s) => s.duration)) <= SHOT_MAX + 0.001, "no shot over SHOT_MAX");
});

console.log(`\n${pass} checks passed`);

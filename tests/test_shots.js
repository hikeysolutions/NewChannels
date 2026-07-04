#!/usr/bin/env node
"use strict";

// Unit test for shot segmentation (lib/shots.js). Self-contained: builds a
// synthetic aligned beat and asserts the invariants assemble.py depends on —
// contiguous tiling, full [0, audioDur] coverage, and ~target cadence.

const { segmentShots, SHOT_TARGET } = require("../agents/lib/shots");

// Synthetic beat: 24s of evenly-spaced words, a comma every ~5 words.
function makeBeat(index, audioDur, nWords) {
  const words = [];
  const step = audioDur / nWords;
  for (let i = 0; i < nWords; i += 1) {
    const start = round(i * step);
    const end = round((i + 1) * step - 0.02);
    const clause = (i + 1) % 5 === 0;
    words.push({ word: `w${i}${clause ? "," : ""}`, start, end });
  }
  return { index, audio_duration_seconds: audioDur, words };
}
function round(n) { return Math.round(n * 1000) / 1000; }

function main() {
  const beats = [makeBeat(0, 24.0, 90), makeBeat(1, 8.0, 30), makeBeat(2, 3.0, 10)];
  const shots = segmentShots(beats);

  const checks = [];
  // 1. contiguity + full coverage per beat
  let gaps = 0, covBad = 0;
  const byBeat = {};
  for (const s of shots) (byBeat[s.beat_index] = byBeat[s.beat_index] || []).push(s);
  for (const beat of beats) {
    const b = byBeat[beat.index] || [];
    for (let i = 1; i < b.length; i += 1) if (Math.abs(b[i].start - b[i - 1].end) > 0.001) gaps += 1;
    if (!b.length || Math.abs(b[0].start) > 0.001 ||
        Math.abs(b[b.length - 1].end - beat.audio_duration_seconds) > 0.001) covBad += 1;
  }
  checks.push(["contiguous (no intra-beat gaps)", gaps === 0]);
  checks.push(["every beat fully covers [0, audioDur]", covBad === 0]);

  // 2. cadence: average near target, no wild outliers
  const durs = shots.map((s) => s.duration);
  const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
  checks.push([`avg shot ~target (${SHOT_TARGET}s), got ${avg.toFixed(2)}s`, avg >= 2.2 && avg <= 3.2]);
  checks.push(["no shot longer than 2x target", Math.max(...durs) <= SHOT_TARGET * 2]);

  // 3. a 3s beat (< target*1.5) stays a single shot
  const beat2Shots = shots.filter((s) => s.beat_index === 2);
  checks.push(["short beat -> single shot", beat2Shots.length === 1]);

  // 4. global shot_index is contiguous from 0
  checks.push(["shot_index contiguous", shots.every((s, i) => s.shot_index === i)]);

  let ok = true;
  console.log(`segmented ${shots.length} shots (avg ${avg.toFixed(2)}s)`);
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exitCode = ok ? 0 : 1;
}

main();

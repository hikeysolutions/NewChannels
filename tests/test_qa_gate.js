#!/usr/bin/env node
"use strict";

// Text-only QA gate test (no paid image/audio/video). Runs the real Section 06
// rubric + gap_logic + factual + em-dash checks against the current
// ancient-humans-at-night script, on a COPY of tracking.db so the live rows are
// never touched. Verifies: voice scores numerically, gap_logic flags the
// all-"opens" stagnation, resolution actually transitions off 'pending', and the
// gate reports blockers.
//
// Usage: node tests/test_qa_gate.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const { runQaPass, blockingFlags } = require(path.join(ROOT, "agents/lib/qa"));

const SLUG = "what-did-ancient-humans-do-at-night";
const CHANNEL = "channel_a";

function main() {
  const srcDb = path.join(ROOT, "db/tracking.db");
  const tmpDb = path.join(os.tmpdir(), `qa_gate_test_${Date.now()}.db`);
  fs.copyFileSync(srcDb, tmpDb);
  const db = new Database(tmpDb);

  try {
    const manifestRel = path.join("ChannelA", "manifests", `${SLUG}.json`);
    const scriptRel = path.join("ChannelA", "scripts", `${SLUG}.md`);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestRel), "utf8"));
    const scenes = manifest.scenes || manifest.blocks || [];
    const scriptText = fs.readFileSync(path.join(ROOT, scriptRel), "utf8");

    // Seed a throwaway video row so flags attach to a real FK, not production id 1.
    const info = db
      .prepare(`INSERT INTO videos (channel, entity, situation, title, status) VALUES (?,?,?,?, 'qa_pending')`)
      .run(CHANNEL, manifest.entity || "", manifest.situation || "", manifest.title || SLUG);
    const videoId = Number(info.lastInsertRowid);
    console.log(`test video id ${videoId} (in copy DB ${tmpDb})`);
    console.log(`scenes: ${scenes.length}  gap_state seq: ${JSON.stringify(scenes.map((s) => s.gap_state))}\n`);

    const summary = runQaPass(db, { videoId, channel: CHANNEL, scriptText, scenes });

    console.log("=== QA PASS SUMMARY ===");
    console.log(`factual_accuracy flags : ${summary.factual}`);
    if (summary.voice) {
      console.log(`voice_consistency      : ${summary.voice.total}/10  rejected=${summary.voice.rejected}`);
      for (const b of summary.voice.breakdown) console.log(`    ${b.q}=${b.score}  ${b.why}`);
    }
    console.log(`gap_logic flags        : ${summary.gapLogic}`);
    console.log(`style_minor flags      : ${summary.styleMinor}`);

    console.log("\n=== qa_flags rows (resolution transitions) ===");
    const rows = db
      .prepare(`SELECT category, resolution, substr(flagged_claim,1,90) AS claim FROM qa_flags WHERE video_id=? ORDER BY id`)
      .all(videoId);
    for (const r of rows) console.log(`  [${r.category}/${r.resolution}] ${r.claim}`);

    const blockers = blockingFlags(db, videoId);
    console.log(`\n=== GATE (real script): ${blockers.length} blocking flag(s) -> ${blockers.length ? "HALT before paid generation" : "clear, would proceed"} ===`);
    for (const b of blockers) console.log(`  [${b.category}/${b.resolution}] ${String(b.flagged_claim).slice(0, 90)}`);

    // ---- bad-fixture pass: prove the gate actually BLOCKS a bad video. ----
    // The real manifest above is a well-arced, passing script (5 scenes, arced gap
    // chain), so it correctly yields zero blockers and CANNOT exercise the block
    // path. gap_logic is the one blocking check that is fully deterministic (no
    // model call): a chain of >= OPENS_RUN_THRESHOLD (7) all-"opens" blocks that
    // never advances is unambiguous stagnation and MUST land a blocking flag.
    const badScenes = Array.from({ length: 8 }, (_, i) => ({
      gap_state: "opens",
      narration: `Bad block ${i}: a new fact opens and nothing ever resolves.`,
      render: { subject_type: "character" },
    }));
    const badInfo = db
      .prepare(`INSERT INTO videos (channel, entity, situation, title, status) VALUES (?,?,?,?, 'qa_pending')`)
      .run(CHANNEL, "stagnation-fixture", "", "STAGNATION FIXTURE (all opens)");
    const badVideoId = Number(badInfo.lastInsertRowid);
    const badSummary = runQaPass(db, {
      videoId: badVideoId, channel: CHANNEL,
      scriptText: "A deliberately stagnant script that never resolves anything.",
      scenes: badScenes,
    });
    const badBlockers = blockingFlags(db, badVideoId);
    console.log(`\n=== BAD FIXTURE (video ${badVideoId}): gap_logic=${badSummary.gapLogic}  blockers=${badBlockers.length} ===`);
    for (const b of badBlockers) console.log(`  [${b.category}/${b.resolution}] ${String(b.flagged_claim).slice(0, 90)}`);

    // ---- assertions ----
    const checks = [];
    const voiceTotal = summary.voice && summary.voice.total;
    checks.push(["voice scored numerically 0-10", Number.isFinite(voiceTotal) && voiceTotal >= 0 && voiceTotal <= 10]);
    checks.push(["style_minor caught em/en dashes (>=1)", summary.styleMinor >= 1]);
    const transitioned = rows.some((r) => r.resolution !== "pending");
    checks.push(["at least one resolution left 'pending'", transitioned]);
    // Good real script must NOT be blocked (no false-positive gate).
    checks.push(["real passing script yields 0 blockers", blockers.length === 0]);
    // Bad fixture must be blocked — this is the whole point of the gate.
    checks.push(["bad fixture flags gap_logic stagnation (>=1)", badSummary.gapLogic >= 1]);
    checks.push(["gate blocks the bad fixture (>=1 blocker)", badBlockers.length >= 1]);

    console.log("\n=== ASSERTIONS ===");
    let allPass = true;
    for (const [name, ok] of checks) {
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
      if (!ok) allPass = false;
    }
    console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
    process.exitCode = allPass ? 0 : 1;
  } finally {
    db.close();
    fs.unlinkSync(tmpDb);
  }
}

main();

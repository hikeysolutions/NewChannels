#!/usr/bin/env node
"use strict";

// flyt-orchestrator.js - Session 4.
// Shared across both channels, parameterized by --channel (Section 03c). Runs the
// full 10-step pipeline (Master Build v2.7 Section 03) for ONE video, from an
// unused entity_situation_bank row through to a rendered MP4 sitting at the
// Telegram approval gate. It does NOT auto-publish to YouTube - the approval gate
// is a hard human stop (Section 03a). Finish line: one videos row at
// status='pending_approval' with a real Telegram message delivered.
//
// This orchestrator does not re-implement the asset stages; it invokes the
// existing agents (flyt-script-generator.js, flyt-stills.py, flyt-hero.py,
// flyt-narrator.py, assemble.py) and owns the DB row + status/cost transitions.
//
// Usage:
//   node agents/flyt-orchestrator.js --channel channel_a
//   node agents/flyt-orchestrator.js --channel channel_a --entity "Vikings" --situation "during war"
//   node agents/flyt-orchestrator.js --channel channel_a --dry-run   (no spend: script+QA real, gen stages dry, assemble/upload/telegram skipped)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadEnv } = require("./lib/env");
const { openDb } = require("./lib/db");
const { runQaPass, blockingFlags } = require("./lib/qa");
const { cloudinaryUpload, telegramSend, bundledCaption } = require("./lib/publish");
const { segmentShots } = require("./lib/shots");
const { costPerImageUsd, resolveImageModel } = require("./lib/models");
const { generateShotPrompt, regenerateVisualPrompt } = require("./lib/qwen");
const { repairVisualPrompts } = require("./lib/vpcheck");

const ROOT = path.resolve(__dirname, "..");
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };
const PYTHON = "python3.11";

// Section 02 cost estimates. There is no billing API, so per-video cost is
// estimated from unit prices and logged to the videos row (Section 00c).
const STILL_COST_USD = 0.034; // NB2 Lite standard, per image (synchronous / Channel B)
// Channel A batch stills cost is no longer hardcoded — it comes from the resolved
// image model in config/image-models.json (costPerImageUsd), so cost follows the model.
const HERO_COST_PER_SEC_USD = 0.05; // Seedance upper-bound, per second

function log(msg) {
  process.stdout.write(`[orch] ${msg}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--channel") args.channel = argv[++i];
    else if (a === "--video-id") args.videoId = Number(argv[++i]);
    else if (a === "--entity") args.entity = argv[++i];
    else if (a === "--situation") args.situation = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.channel !== "channel_a" && args.channel !== "channel_b") {
    throw new Error("--channel is required and must be channel_a or channel_b");
  }
  if ((args.entity && !args.situation) || (!args.entity && args.situation)) {
    throw new Error("--entity and --situation must be provided together");
  }
  return args;
}

// ---- preflight: every key the live run needs. Report and STOP if any missing,
// so a paid run never half-completes (constraint from the build directive). ----
function preflight(env) {
  const need = {
    "Gemini (stills)": env.NEWCHANNELS_GEMINI_API_KEY || env.GEMINI_API_KEY,
    "Atlas Cloud (hero)": env.NEWCHANNELS_ATLASCLOUD_API_KEY || env.ATLASCLOUD_API_KEY,
    "Groq/Cerebras (script)": env.NEWCHANNELS_GROQ_API_KEY || env.GROQ_API_KEY || env.CEREBRAS_API_KEY,
    // Dedicated New Channels account preferred; falls back to the generic set
    // (same NEWCHANNELS_*-first convention the stills/hero agents use for keys).
    "Cloudinary cloud name": env.NEWCHANNELS_CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME,
    "Cloudinary API key": env.NEWCHANNELS_CLOUDINARY_API_KEY || env.CLOUDINARY_API_KEY,
    "Cloudinary API secret": env.NEWCHANNELS_CLOUDINARY_API_SECRET || env.CLOUDINARY_API_SECRET,
    "FlytBot token": env.FLYT_BOT_TOKEN,
    "FlytBot chat id": env.FLYT_CHAT_ID,
  };
  const missing = Object.entries(need).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
  if (missing.length) {
    process.stderr.write(
      `[orch] PREFLIGHT FAILED - not starting a paid run. Missing:\n` +
        missing.map((m) => `  - ${m}`).join("\n") +
        `\n[orch] Set these in ~/.openclaw/.env, then re-run. No API calls were made.\n`
    );
    return false;
  }
  log("preflight ok - all live-run credentials present");
  return true;
}

// ---- small orchestrator-level retry-once-then-alert (the Python agents already
// own their own; this covers the JS-side stages: script-gen, cloudinary, telegram) ----
function retryOnce(label, fn) {
  try {
    return fn();
  } catch (firstErr) {
    process.stderr.write(`[orch] ${label}: attempt 1 failed (${firstErr.message}); retrying once...\n`);
    return fn();
  }
}

// Orchestrator-level catch-all alert. Fires the SAME alert channel the Python
// agents use (agents/alert.py) rather than duplicating Telegram logic here.
// Best-effort: never throws, so it cannot mask the failure it is reporting.
function orchestratorAlert(summary, detail) {
  const text = `🚨 New Channels orchestrator: ${summary}${detail ? `\n${String(detail).slice(-600)}` : ""}`;
  try {
    execFileSync(PYTHON, [path.join("agents", "alert.py"), text], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (e) {
    process.stderr.write(`[orch] orchestrator alert could not be sent: ${e.message}\n`);
  }
}

function runStage(label, cmd, cmdArgs) {
  log(`${label}: ${cmd} ${cmdArgs.join(" ")}`);
  try {
    return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch (err) {
    // An agent exited non-zero (or failed to spawn). This is the catch-all for
    // failures validate.py's per-agent alert cannot reach: e.g. produce() raising
    // on BOTH attempts (API 500 x2) exits the agent before any Report exists, so
    // run_with_retry's alert never runs. Agent stderr is inherited (already
    // logged live); fire one Telegram alert with stage + exit info, then rethrow
    // so the orchestrator's own FATAL flow is unchanged.
    const code = err.status != null ? err.status : (err.signal || "spawn-failed");
    orchestratorAlert(`stage "${label}" failed (exit ${code})`, err.message);
    throw err;
  }
}

// ---- DB helpers (better-sqlite3 handle from openDb) ----
function firstUnusedCombo(db, channel, entityOverride, situationOverride) {
  if (entityOverride && situationOverride) {
    const row = db
      .prepare(`SELECT * FROM entity_situation_bank WHERE channel=? AND entity=? AND situation=?`)
      .get(channel, entityOverride, situationOverride);
    if (!row) throw new Error(`combo not found in bank: ${channel}/${entityOverride}/${situationOverride}`);
    return row;
  }
  const row = db
    .prepare(
      `SELECT * FROM entity_situation_bank WHERE channel=?
         ORDER BY used_count ASC, (last_used_at IS NULL) DESC, id ASC LIMIT 1`
    )
    .get(channel);
  if (!row) throw new Error(`entity_situation_bank has no rows for channel "${channel}"`);
  return row;
}

function setStatus(db, videoId, status, extra = {}) {
  const cols = ["status = @status"];
  const params = { id: videoId, status };
  for (const [k, v] of Object.entries(extra)) {
    cols.push(`${k} = @${k}`);
    params[k] = v;
  }
  db.prepare(`UPDATE videos SET ${cols.join(", ")} WHERE id = @id`).run(params);
  log(`videos[${videoId}] -> ${status}`);
}

// ---- QA / accuracy gate (Section 03 step 2 + Section 06 rubric). The scoring
// itself lives in lib/qa.js (factual_accuracy, voice_consistency, gap_logic,
// style_minor). This helper just loads the scene list the pass needs. ----
function loadScenes(manifestRel) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestRel), "utf8"));
  const scenes = manifest.scenes || manifest.blocks || [];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error(`manifest ${manifestRel} has no scenes to QA`);
  }
  return scenes;
}


// ---- Channel A Phase 1 (async stills). Reordered from the synchronous flow:
// narration must precede stills because stills are cut at the narration's aligned
// timestamps. Everything here is FREE (local VoxCPM + whisper + qwen) EXCEPT the
// final Batch submit; dry-run stubs only that submit. Ends by persisting the batch
// job id + status='awaiting_stills' and exiting — the cron poller (Phase 2)
// collects the images, assembles, and publishes. ----
async function runChannelAPhase1(db, env, ctx) {
  const { channel, videoId, manifestRel, scriptRel, slug, combo, qa, voiceStr, dryRun } = ctx;
  const chDir = path.join(ROOT, CHANNEL_DIRS[channel]);

  setStatus(db, videoId, "generating");

  // 1. Narration (local VoxCPM, voice-clone locked). Free; real even in dry-run.
  runStage("narrator", PYTHON, ["agents/flyt-narrator.py", "--channel", channel, "--manifest", manifestRel]);

  // 2. Forced alignment (local stable-ts). Free. Writes <slug>.align.json.
  runStage("align", PYTHON, ["agents/flyt-align.py", "--channel", channel, "--manifest", manifestRel]);
  // (Stage 5 length verification will slot in here once approved.)

  // 3. Shot segmentation from the real aligned timestamps (content-driven cuts).
  const align = JSON.parse(fs.readFileSync(path.join(chDir, "manifests", `${slug}.align.json`), "utf8"));
  const shots = segmentShots(align.beats);
  log(`shots: ${shots.length} windows (avg ${(align.total_audio_seconds / Math.max(1, shots.length)).toFixed(2)}s)`);

  // 4. Shot-prompt pass (local qwen) + windowed vpcheck. Attach each shot's beat
  //    render block so the batch prompt carries era/setting + CHANNEL_STYLE.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestRel), "utf8"));
  const shotObjs = [];
  for (let i = 0; i < shots.length; i += 1) {
    const vp = await generateShotPrompt({
      shotText: shots[i].text,
      prevText: i > 0 ? shots[i - 1].text : null,
      nextText: i < shots.length - 1 ? shots[i + 1].text : null,
      channel, entity: combo.entity, situation: combo.situation,
    });
    const beat = manifest.scenes[shots[i].beat_index];
    shotObjs.push({ ...shots[i], visual_prompt: vp, render: beat ? beat.render : null });
  }
  const repair = await repairVisualPrompts(shotObjs, {
    regenerate: ({ scene, avoid, otherPrompts }) =>
      regenerateVisualPrompt({ scene, avoid, otherPrompts, channel, entity: combo.entity, situation: combo.situation }),
    maxAttempts: 2,
  });
  log(`shot prompts: ${repair.scenes.length} generated, repaired ${repair.repaired.length}, qa_flagged ${repair.flagged.length}`);

  // 5. Write <slug>.shots.json — the input to both the Batch submit and assembly.
  const shotsPath = path.join(chDir, "manifests", `${slug}.shots.json`);
  fs.writeFileSync(shotsPath, `${JSON.stringify({ channel, title: manifest.title, slug, aspect: "16:9", shots: repair.scenes }, null, 2)}\n`);
  const shotsRel = path.relative(ROOT, shotsPath);

  // 6. Submit the stills Batch job (dry-run stubs the actual submit).
  const submitArgs = ["agents/flyt-stills.py", "--channel", channel, "--shots", shotsRel, "--batch-submit"];
  if (dryRun) submitArgs.push("--dry-run");
  const out = runStage("batch submit", PYTHON, submitArgs);

  const batchStillCost = costPerImageUsd(channel);
  const estCost = Number((repair.scenes.length * batchStillCost).toFixed(4));

  if (dryRun) {
    setStatus(db, videoId, "dry_run_complete", { manifest_path: manifestRel, script_path: scriptRel, cost_stills: estCost, cost_total: estCost });
    log("================ DRY-RUN COMPLETE (channel_a async) ================");
    log(`video ${videoId}, slug "${slug}", ${repair.scenes.length} shots (~$${estCost} batch stills est.)`);
    log(`QA: factual=${qa.factual} voice=${voiceStr} gap_logic=${qa.gapLogic} -> gate CLEAR`);
    log("narrator + align + shots + shot-prompts real (free); batch submit stubbed. No paid I/O.");
    log("===================================================================");
    return;
  }

  const jm = out.match(/BATCH_JOB=(\S+)/);
  if (!jm) throw new Error("batch submit did not return a BATCH_JOB name");
  const batchJob = jm[1];
  setStatus(db, videoId, "awaiting_stills", {
    batch_job_id: batchJob,
    batch_submitted_at: new Date().toISOString(),
    manifest_path: manifestRel,
    script_path: scriptRel,
    cost_stills: estCost,
    cost_total: estCost,
  });
  log("================ PHASE 1 COMPLETE — awaiting_stills ================");
  log(`video ${videoId}, slug "${slug}": ${repair.scenes.length} shots submitted as batch ${batchJob}`);
  log(`estimated stills cost ~$${estCost} (batch $${batchStillCost}/image, model ${resolveImageModel(channel)}). The poller will collect + assemble + publish.`);
  log("===================================================================");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  // Dry-run exercises the full chain with no paid stages, so it only needs the
  // (free) script model key; the paid-key preflight is skipped.
  if (args.dryRun) {
    const scriptKey = env.NEWCHANNELS_GROQ_API_KEY || env.GROQ_API_KEY || env.CEREBRAS_API_KEY;
    if (!scriptKey || !String(scriptKey).trim()) {
      process.stderr.write("[orch] DRY-RUN PREFLIGHT FAILED - need a Groq/Cerebras key for script generation.\n");
      process.exit(2);
    }
    log("dry-run: paid-key preflight skipped (only script generation + local QA run)");
  } else if (!preflight(env)) {
    process.exit(2);
  }

  const channel = args.channel;
  const dbPath = env.NEWCHANNELS_DB_PATH || "~/OpenClaw/NewChannels/db/tracking.db";
  const db = openDb(dbPath);

  try {
    // STEP 1 — pick one unused combo (first of the 7 seeded, all used_count=0).
    const combo = firstUnusedCombo(db, channel, args.entity, args.situation);
    log(`combo: ${combo.entity} / ${combo.situation} (bank id ${combo.id}, used_count ${combo.used_count})`);

    // STEP 2 — script + scene JSON. flyt-script-generator.js inserts the videos row
    // (status='scripting'), writes the manifest, and marks the combo used. We parse
    // its output for the row id + manifest path and own the row from here on.
    const genOut = retryOnce("script-generator", () =>
      runStage("script gen", "node", [
        "agents/flyt-script-generator.js",
        "--channel", channel,
        "--entity", combo.entity,
        "--situation", combo.situation,
      ])
    );
    const m = genOut.match(/video id (\d+) -> (\S+) \+ (\S+)/);
    if (!m) throw new Error("could not parse video id / manifest path from script-generator output");
    const videoId = Number(m[1]);
    const manifestRel = m[3];
    const slug = path.basename(manifestRel, ".json");
    log(`video id ${videoId}, slug "${slug}", manifest ${manifestRel}`);

    // STEP 3 — QA / accuracy pass (Section 03 step 2 + Section 06 rubric). Scores
    // factual accuracy, voice consistency, and gap logic; logs each to qa_flags.
    const scriptRel = m[2];
    const scriptText = fs.readFileSync(path.join(ROOT, scriptRel), "utf8");
    const scenes = loadScenes(manifestRel);
    setStatus(db, videoId, "qa_pending");
    const qa = runQaPass(db, { videoId, channel, scriptText, scenes });
    const voiceStr = qa.voice && qa.voice.total != null ? `${qa.voice.total}/10` : "unscored";
    log(`QA pass: factual=${qa.factual} voice=${voiceStr} gap_logic=${qa.gapLogic} style_minor=${qa.styleMinor}`);

    // STEP 3a — HARD GATE. If any unresolved blocking flag exists for this video,
    // halt BEFORE paid generation, set a real blocking status, alert, and stop.
    // Default is a human decision — no auto-repair-and-proceed (build directive).
    const blockers = blockingFlags(db, videoId);
    if (blockers.length) {
      const lines = blockers.map((b) => `  [${b.category}/${b.resolution}] ${b.flagged_claim}`).join("\n");
      const reason = `${blockers.length} unresolved QA blocker(s):\n${lines}`;
      setStatus(db, videoId, "qa_blocked", { reject_reason: reason.slice(0, 1000) });
      orchestratorAlert(
        `video ${videoId} (${channel}) BLOCKED at QA gate — ${blockers.length} unresolved flag(s), no paid generation`,
        reason
      );
      log("================ QA GATE: BLOCKED ================");
      log(`video ${videoId} halted before paid generation. ${blockers.length} blocking flag(s):`);
      log(lines);
      log("Resolve in qa_flags (set resolution to 'rewritten'/'confirmed_accurate' or reject), then re-run.");
      log("=================================================");
      return;
    }
    log("QA gate: clear — no unresolved blocking flags, proceeding to generation");

    // Channel A: two-phase async stills (Batch API). Reordered pipeline, ends at
    // 'awaiting_stills' for the poller. Channel B keeps the synchronous flow below.
    if (channel === "channel_a") {
      await runChannelAPhase1(db, env, {
        channel, videoId, manifestRel, scriptRel, slug, combo, qa, voiceStr, dryRun: args.dryRun,
      });
      return;
    }

    // ---- DRY-RUN branch: exercise every stage that has a --dry-run mode with no
    // API calls / no writes, then stop before the stages that require real assets
    // or paid I/O (assemble/cloudinary/telegram). Confirms the chain wires up end
    // to end under today's combined code without spending anything. ----
    if (args.dryRun) {
      setStatus(db, videoId, "generating");
      runStage("stills (dry)", PYTHON, ["agents/flyt-stills.py", "--channel", channel, "--manifest", manifestRel, "--dry-run"]);
      runStage("hero (dry)", PYTHON, ["agents/flyt-hero.py", "--channel", channel, "--manifest", manifestRel, "--dry-run"]);
      runStage("narrator (dry)", PYTHON, ["agents/flyt-narrator.py", "--channel", channel, "--manifest", manifestRel, "--dry-run"]);
      setStatus(db, videoId, "dry_run_complete");
      log("================ DRY-RUN COMPLETE ================");
      log(`combo: ${combo.entity} / ${combo.situation} (bank id ${combo.id})`);
      log(`video id ${videoId}, slug "${slug}"`);
      log(`QA: factual=${qa.factual} voice=${voiceStr} gap_logic=${qa.gapLogic} style_minor=${qa.styleMinor} -> gate CLEAR`);
      log("stills/hero/narrator dry-run OK. Skipped (need real assets / paid I/O): assemble, cloudinary, telegram.");
      log("No API calls made, no media written.");
      log("=================================================");
      return;
    }

    // STEP 4 — generation (stills, hero, narration). Each agent self-validates with
    // retry-once-then-alert internally (validate.py); a hard failure throws here.
    setStatus(db, videoId, "generating");
    runStage("stills", PYTHON, ["agents/flyt-stills.py", "--channel", channel, "--manifest", manifestRel]);
    runStage("hero", PYTHON, ["agents/flyt-hero.py", "--channel", channel, "--manifest", manifestRel]);
    runStage("narrator", PYTHON, ["agents/flyt-narrator.py", "--channel", channel, "--manifest", manifestRel]);

    // Cost accounting from the stills/hero sidecars (Section 02 estimates).
    const chDir = path.join(ROOT, CHANNEL_DIRS[channel]);
    const stillsSc = JSON.parse(fs.readFileSync(path.join(chDir, "manifests", `${slug}.stills.json`), "utf8"));
    const heroSc = JSON.parse(fs.readFileSync(path.join(chDir, "manifests", `${slug}.hero.json`), "utf8"));
    const costStills = (stillsSc.assets || []).length * STILL_COST_USD;
    const heroSecs = (heroSc.assets || []).reduce((s, a) => s + (a.actual_duration_seconds || 0), 0);
    const costHero = heroSecs * HERO_COST_PER_SEC_USD;
    const costTotal = costStills + costHero;
    setStatus(db, videoId, "generating", {
      cost_stills: Number(costStills.toFixed(4)),
      cost_hero: Number(costHero.toFixed(4)),
      cost_total: Number(costTotal.toFixed(4)),
    });
    log(`cost: stills $${costStills.toFixed(3)} + hero $${costHero.toFixed(3)} = $${costTotal.toFixed(3)}`);

    // STEP 5 — assembly -> outputs/<slug>.mp4 (assemble.py self-validates).
    setStatus(db, videoId, "assembling");
    runStage("assemble", PYTHON, ["agents/assemble.py", "--channel", channel, "--slug", slug]);
    const mp4Path = path.join(chDir, "outputs", `${slug}.mp4`);
    if (!fs.existsSync(mp4Path)) throw new Error(`assembled MP4 not found: ${mp4Path}`);

    // STEP 6 — upload to Cloudinary under new-channels/<channel>/ (Section 02a).
    const row = db.prepare(`SELECT title FROM videos WHERE id=?`).get(videoId);
    const upload = await retryOnce("cloudinary", () =>
      cloudinaryUpload(env, mp4Path, `new-channels/${channel}`, slug, log)
    );
    const videoUrl = upload.secure_url;
    const thumbUrl = videoUrl.replace(/\.mp4$/, ".jpg"); // Cloudinary auto-derives a poster frame
    log(`cloudinary: ${videoUrl}`);

    // STEP 7 — Telegram bundled message via FlytBot (Section 03a v2.7). Try a photo
    // (thumbnail + caption); fall back to a text message if the poster isn't ready.
    const caption = bundledCaption({
      title: row.title, entity: combo.entity, situation: combo.situation, channel,
      costTotal, videoUrl, shortCount: 0,
    });
    const tg = await retryOnce("telegram", async () => {
      try {
        return await telegramSend(env, "sendPhoto", { chat_id: env.FLYT_CHAT_ID, photo: thumbUrl, caption });
      } catch (e) {
        process.stderr.write(`[orch] sendPhoto failed (${e.message}); falling back to sendMessage\n`);
        return telegramSend(env, "sendMessage", { chat_id: env.FLYT_CHAT_ID, text: caption });
      }
    });
    log(`telegram delivered: message_id ${tg.message_id}`);

    // STEP 8 — HARD STOP at the approval gate. No YouTube upload. Human replies in TG.
    setStatus(db, videoId, "pending_approval", {
      manifest_path: manifestRel,
      script_path: scriptRel,
    });

    // ---- verification report ----
    const finalRow = db.prepare(`SELECT * FROM videos WHERE id=?`).get(videoId);
    log("================ SESSION 4 RESULT ================");
    log(`videos row: ${JSON.stringify(finalRow, null, 2)}`);
    log(`cloudinary link: ${videoUrl}`);
    log(`telegram message_id: ${tg.message_id} (delivered to chat ${env.FLYT_CHAT_ID})`);
    log(`total real cost (estimated from Section 02 unit prices): $${costTotal.toFixed(3)}`);
    log("Video is at pending_approval. It will NOT publish until a human approves in Telegram.");
    log("==================================================");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[orch] FATAL: ${err.message}\n`);
  process.exitCode = 1;
});

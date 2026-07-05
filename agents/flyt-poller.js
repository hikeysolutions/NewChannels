#!/usr/bin/env node
"use strict";

// flyt-poller.js - Phase 2 of the Channel A async-stills architecture.
// flyt-orchestrator.js (Phase 1) ends each Channel A video at
// status='awaiting_stills' with a Gemini Batch job id persisted on the row. This
// poller is the other half: run on a schedule (LaunchAgent, Section 00b), it scans
// every 'awaiting_stills' row, tries to COLLECT its finished batch images, and on
// success ASSEMBLES the final MP4 and PUBLISHES it to the SAME approval gate the
// synchronous orchestrator path uses (Cloudinary upload + Telegram bundled
// message). It NEVER uploads to YouTube. The hard stop is unchanged: a collected +
// assembled video lands at status='pending_approval' and waits for a human Telegram
// reply, exactly like the legacy path.
//
// One pass per invocation, then exit (the LaunchAgent re-launches on StartInterval).
// Batch state comes from flyt-stills.py --batch-collect, whose exit codes are the
// contract: 0 = collected (wrote <slug>.stills.json), 2 = pending/not-ready (leave
// the row for the next cycle), anything else = a real failure.
//
// Usage:
//   node agents/flyt-poller.js                 (one live pass over all awaiting_stills rows)
//   node agents/flyt-poller.js --video-id 3    (poll just one row)
//   node agents/flyt-poller.js --dry-run       (stub collect/assemble/publish: exercise the state machine, no spend/no external I/O)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadEnv } = require("./lib/env");
const { openDb } = require("./lib/db");
const { cloudinaryUpload, telegramSend, bundledCaption } = require("./lib/publish");

const ROOT = path.resolve(__dirname, "..");
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };
const PYTHON = "python3.11";

// A batch still pending this long after submit is treated as stuck: Gemini Batch
// states up to a 24h turnaround, so 48h is a generous ceiling. Stale rows are
// alerted and moved to 'stills_stale' so they stop being polled forever.
const STALE_HOURS = 48;

// Exit code flyt-stills.py --batch-collect returns while the job is still running.
const COLLECT_PENDING_EXIT = 2;

function log(msg) {
  process.stdout.write(`[poll] ${msg}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--video-id") args.videoId = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

// Set once in main(). In dry-run the poller makes NO external I/O, so alerts are
// logged instead of sent to Telegram.
let DRY_RUN = false;

// Same alert channel the orchestrator + Python agents use (agents/alert.py); never
// throws, so it cannot mask the failure it reports. Log-only under --dry-run.
function pollerAlert(summary, detail) {
  const text = `🚨 New Channels poller: ${summary}${detail ? `\n${String(detail).slice(-600)}` : ""}`;
  if (DRY_RUN) {
    log(`[dry] would alert: ${summary}`);
    return;
  }
  try {
    execFileSync(PYTHON, [path.join("agents", "alert.py"), text], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (e) {
    process.stderr.write(`[poll] alert could not be sent: ${e.message}\n`);
  }
}

// Retry-once-then-let-it-throw, matching the orchestrator's JS-side stage policy.
function retryOnce(label, fn) {
  try {
    return fn();
  } catch (firstErr) {
    process.stderr.write(`[poll] ${label}: attempt 1 failed (${firstErr.message}); retrying once...\n`);
    return fn();
  }
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

// Derive the per-video paths the poller needs from the row's manifest_path.
function pathsFor(row) {
  const chDir = path.join(ROOT, CHANNEL_DIRS[row.channel]);
  const slug = path.basename(row.manifest_path, ".json");
  return {
    chDir,
    slug,
    shotsRel: path.join(CHANNEL_DIRS[row.channel], "manifests", `${slug}.shots.json`),
    mp4Path: path.join(chDir, "outputs", `${slug}.mp4`),
  };
}

// Is a still-pending batch older than STALE_HOURS? batch_submitted_at is an ISO
// string persisted at Phase-1 submit time.
function isStale(row) {
  if (!row.batch_submitted_at) return false;
  const submitted = Date.parse(row.batch_submitted_at);
  if (Number.isNaN(submitted)) return false;
  return Date.now() - submitted > STALE_HOURS * 3600 * 1000;
}

// Attempt the batch collect. Returns one of "collected" | "pending" | "failed".
// Live: shells to flyt-stills.py --batch-collect and reads its exit-code contract.
// Dry-run: a stub that returns "pending" on the first poll of a slug and
// "collected" on the second (marker file), so a two-pass test exercises the full
// pending -> complete transition without a real batch job.
function collectBatch(row, paths, dryRun) {
  if (dryRun) return stubCollect(paths);
  try {
    execFileSync(
      PYTHON,
      ["agents/flyt-stills.py", "--channel", row.channel, "--shots", paths.shotsRel, "--job", row.batch_job_id, "--batch-collect"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] }
    );
    return "collected";
  } catch (err) {
    if (err.status === COLLECT_PENDING_EXIT) return "pending";
    const code = err.status != null ? err.status : (err.signal || "spawn-failed");
    pollerAlert(`video ${row.id} (${paths.slug}) batch collect failed (exit ${code})`, err.message);
    return "failed";
  }
}

// Stub collector for --dry-run: flips pending -> collected across two invocations
// via a marker in the video's tmp dir, then cleans up so the test can be re-run.
function stubCollect(paths) {
  const markDir = path.join(paths.chDir, "tmp", paths.slug);
  fs.mkdirSync(markDir, { recursive: true });
  const mark = path.join(markDir, ".poll_stub");
  if (!fs.existsSync(mark)) {
    fs.writeFileSync(mark, "polled\n");
    log("[dry] stub batch state: PENDING (first poll)");
    return "pending";
  }
  fs.unlinkSync(mark);
  log("[dry] stub batch state: SUCCEEDED (second poll)");
  return "collected";
}

// Assemble the collected stills + narration into the final MP4. Dry-run stubs this
// (no ffmpeg, no real assets required); live shells to assemble.py and verifies the
// output file exists, same as the synchronous orchestrator path.
function assemble(row, paths, dryRun) {
  setStatus(db, row.id, "assembling");
  if (dryRun) {
    log(`[dry] would assemble -> ${path.relative(ROOT, paths.mp4Path)} (skipped: no real stills/audio)`);
    return;
  }
  log(`assemble: ${PYTHON} agents/assemble.py --channel ${row.channel} --slug ${paths.slug}`);
  execFileSync(PYTHON, ["agents/assemble.py", "--channel", row.channel, "--slug", paths.slug], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"],
  });
  if (!fs.existsSync(paths.mp4Path)) throw new Error(`assembled MP4 not found: ${paths.mp4Path}`);
}

// Publish to the approval gate: Cloudinary upload + Telegram bundled message, then
// status='pending_approval'. HARD RULE: no YouTube upload, no auto-publish — this
// only reaches pending_approval and waits for a human Telegram reply. Dry-run stubs
// the external calls but still lands the row at pending_approval so the state
// machine is exercised end to end.
async function publish(env, row, paths, dryRun) {
  if (dryRun) {
    log(`[dry] would cloudinary-upload ${path.relative(ROOT, paths.mp4Path)} + telegram approval message (skipped: no external I/O)`);
    setStatus(db, row.id, "pending_approval");
    log(`[dry] video ${row.id} at pending_approval (no publish; human approval still required)`);
    return;
  }

  const upload = await retryOnce("cloudinary", () =>
    cloudinaryUpload(env, paths.mp4Path, `new-channels/${row.channel}`, paths.slug, log)
  );
  const videoUrl = upload.secure_url;
  const thumbUrl = videoUrl.replace(/\.mp4$/, ".jpg"); // Cloudinary auto-derives a poster frame
  log(`cloudinary: ${videoUrl}`);

  const caption = bundledCaption({
    title: row.title, entity: row.entity, situation: row.situation, channel: row.channel,
    costTotal: row.cost_total || 0, videoUrl, shortCount: 0,
  });
  const tg = await retryOnce("telegram", async () => {
    try {
      return await telegramSend(env, "sendPhoto", { chat_id: env.FLYT_CHAT_ID, photo: thumbUrl, caption });
    } catch (e) {
      process.stderr.write(`[poll] sendPhoto failed (${e.message}); falling back to sendMessage\n`);
      return telegramSend(env, "sendMessage", { chat_id: env.FLYT_CHAT_ID, text: caption });
    }
  });
  log(`telegram delivered: message_id ${tg.message_id}`);

  // HARD STOP at the approval gate. No YouTube upload. Human replies in Telegram.
  setStatus(db, row.id, "pending_approval");
  log(`video ${row.id} at pending_approval — will NOT publish until a human approves in Telegram.`);
}

// Drive one video from awaiting_stills through collect -> assemble -> publish.
// Isolated so one bad row cannot abort the whole pass.
async function processRow(env, row, dryRun) {
  const paths = pathsFor(row);
  log(`video ${row.id} "${paths.slug}" — batch ${row.batch_job_id || "(none)"}`);

  if (!row.batch_job_id && !dryRun) {
    pollerAlert(`video ${row.id} (${paths.slug}) is awaiting_stills with no batch_job_id`, "cannot collect; needs manual review");
    setStatus(db, row.id, "stills_failed", { reject_reason: "awaiting_stills with no batch_job_id" });
    return;
  }

  const state = collectBatch(row, paths, dryRun);
  if (state === "pending") {
    if (isStale(row)) {
      pollerAlert(`video ${row.id} (${paths.slug}) batch stuck >${STALE_HOURS}h`, `submitted ${row.batch_submitted_at}, still pending`);
      setStatus(db, row.id, "stills_stale", { reject_reason: `batch pending >${STALE_HOURS}h (submitted ${row.batch_submitted_at})` });
    } else {
      log(`video ${row.id}: batch not ready, leaving awaiting_stills for next cycle`);
    }
    return;
  }
  if (state === "failed") {
    setStatus(db, row.id, "stills_failed", { reject_reason: "batch collect failed (see alert/log)" });
    return;
  }

  // state === "collected"
  assemble(row, paths, dryRun);
  await publish(env, row, paths, dryRun);
}

let db;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  DRY_RUN = !!args.dryRun;
  const env = loadEnv();
  const dbPath = env.NEWCHANNELS_DB_PATH || "~/OpenClaw/NewChannels/db/tracking.db";
  db = openDb(dbPath);

  try {
    const rows = args.videoId
      ? db.prepare(`SELECT * FROM videos WHERE id=? AND status='awaiting_stills'`).all(args.videoId)
      : db.prepare(`SELECT * FROM videos WHERE status='awaiting_stills' ORDER BY id ASC`).all();

    if (rows.length === 0) {
      log(args.videoId ? `no awaiting_stills row for video ${args.videoId}` : "no videos awaiting stills — nothing to do");
      return;
    }
    log(`${rows.length} video(s) awaiting stills${args.dryRun ? " (dry-run: stubbed collect/assemble/publish)" : ""}`);

    for (const row of rows) {
      try {
        await processRow(env, row, args.dryRun);
      } catch (err) {
        pollerAlert(`video ${row.id} poll failed`, err.message);
        process.stderr.write(`[poll] video ${row.id} error: ${err.message}\n`);
        try {
          setStatus(db, row.id, "stills_failed", { reject_reason: String(err.message).slice(0, 1000) });
        } catch (_) { /* row status best-effort */ }
      }
    }
    log("pass complete");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[poll] FATAL: ${err.message}\n`);
  process.exitCode = 1;
});

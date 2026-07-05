#!/usr/bin/env node
"use strict";

// flyt-approvals.js - the human-approval reply handler (Section 03a).
// flyt-poller.js / flyt-orchestrator.js land a finished video at
// status='pending_approval' and send a bundled Telegram message via FlytBot,
// persisting that message's id + chat on the row (tg_message_id / tg_chat_id,
// migration 002). This agent is the other half: run on a schedule (LaunchAgent),
// it long-polls FlytBot's getUpdates, matches each human reply back to its
// videos row, and writes the approve/reject decision.
//
// STEP 2 SCOPE (this file, current): state writes only.
//   approve -> status='approved'  (YouTube upload is step 3, not done here)
//   reject  -> status='rejected', reject_reason saved, tmp/ assets kept
// The YouTube videos.insert + 'published' transition + cleanup are added in a
// later step and deliberately absent here, so an approve lands at 'approved' and
// stops. The bundled multi-shorts grammar (approve short_n, per-item reject) is a
// later step too; this parser handles the long-form approve/reject case and
// treats anything it does not understand as a no-op with a help reply.
//
// One pass per invocation, then exit (the LaunchAgent re-launches on StartInterval),
// matching flyt-poller.js. getUpdates offset is persisted between runs so a reply
// is never processed twice and Telegram drops acknowledged updates server-side.
//
// Usage:
//   node agents/flyt-approvals.js            (one live pass: drain queued replies, act, exit)
//   node agents/flyt-approvals.js --dry-run  (parse + match + log decisions; no DB writes, no Telegram replies)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { loadEnv } = require("./lib/env");
const { openDb } = require("./lib/db");
const { telegramSend } = require("./lib/publish");

const ROOT = path.resolve(__dirname, "..");
const PYTHON = "python3.11";

// Where the last processed Telegram update_id is persisted between invocations.
// A plain JSON file (no schema change), sitting beside the tracking DB.
const OFFSET_FILE = path.join(ROOT, "db", "approvals_offset.json");

// Long-poll seconds handed to getUpdates. Short but non-zero so a reply landing
// mid-pass is still caught within one invocation without holding the process open.
const GETUPDATES_TIMEOUT_S = 5;

function log(msg) {
  process.stdout.write(`[approve] ${msg}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

let DRY_RUN = false;

// Same alert channel the poller + Python agents use (agents/alert.py). Never
// throws, so it cannot mask the failure it reports. Log-only under --dry-run.
function approvalsAlert(summary, detail) {
  const text = `🚨 New Channels approvals: ${summary}${detail ? `\n${String(detail).slice(-600)}` : ""}`;
  if (DRY_RUN) {
    log(`[dry] would alert: ${summary}`);
    return;
  }
  try {
    execFileSync(PYTHON, [path.join("agents", "alert.py"), text], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (e) {
    process.stderr.write(`[approve] alert could not be sent: ${e.message}\n`);
  }
}

// ---- offset persistence (getUpdates idempotency) ----

// Returns the next offset to request (last processed update_id + 1), or undefined
// on first ever run so getUpdates returns the full backlog.
function loadOffset() {
  try {
    const raw = fs.readFileSync(OFFSET_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.last_update_id === "number") return parsed.last_update_id + 1;
  } catch (_) { /* no offset file yet, or unreadable: start from the backlog */ }
  return undefined;
}

function saveOffset(lastUpdateId) {
  if (DRY_RUN) {
    log(`[dry] would save offset last_update_id=${lastUpdateId}`);
    return;
  }
  // Immutable write: new object, atomic-ish replace.
  const tmp = `${OFFSET_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ last_update_id: lastUpdateId }, null, 2));
  fs.renameSync(tmp, OFFSET_FILE);
}

// ---- DB write helper (same shape as the poller's) ----

function setStatus(db, videoId, status, extra = {}) {
  const cols = ["status = @status"];
  const params = { id: videoId, status };
  for (const [k, v] of Object.entries(extra)) {
    cols.push(`${k} = @${k}`);
    params[k] = v;
  }
  if (DRY_RUN) {
    log(`[dry] would set videos[${videoId}] -> ${status}${Object.keys(extra).length ? ` (${JSON.stringify(extra)})` : ""}`);
    return;
  }
  db.prepare(`UPDATE videos SET ${cols.join(", ")} WHERE id = @id`).run(params);
  log(`videos[${videoId}] -> ${status}`);
}

// ---- command parsing ----
// STEP 2: long-form approve/reject only. Returns { action, reason } or null.
// The bundled grammar (approve all|long|short_n, per-item reject) arrives in a
// later step; unrecognized text yields null and a help reply, never a wrong write.
function parseCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "approve" || lower.startsWith("approve ") || lower === "approve all" || lower === "approve long") {
    return { action: "approve" };
  }
  if (lower === "reject" || lower.startsWith("reject ")) {
    // Everything after the leading "reject" token is the reason (may be empty).
    const reason = trimmed.slice("reject".length).trim();
    return { action: "reject", reason: reason || "(no reason given)" };
  }
  return null;
}

// ---- reply -> videos row matching ----
// Primary key: the reply's reply_to_message.message_id must equal the row's
// persisted tg_message_id (scoped to tg_chat_id). Fallback when the human typed a
// bare command without using Telegram's reply: if exactly one row in this chat is
// pending_approval, use it; if more than one, refuse to guess.
function matchRow(db, msg) {
  const chatId = String(msg.chat.id);
  const reply = msg.reply_to_message;

  if (reply && reply.message_id) {
    const row = db
      .prepare(`SELECT * FROM videos WHERE tg_message_id = ? AND tg_chat_id = ? AND status = 'pending_approval'`)
      .get(reply.message_id, chatId);
    if (row) return { row };
    return { error: "no pending video matches that message (already handled, or replied to the wrong message)" };
  }

  const pending = db
    .prepare(`SELECT * FROM videos WHERE tg_chat_id = ? AND status = 'pending_approval' ORDER BY id ASC`)
    .all(chatId);
  if (pending.length === 1) return { row: pending[0] };
  if (pending.length === 0) return { error: "nothing is awaiting approval right now" };
  return { error: `${pending.length} videos are awaiting approval — reply directly to the one you mean` };
}

// ---- Telegram reply back into the thread ----
async function replyTo(env, msg, text) {
  if (DRY_RUN) {
    log(`[dry] would reply: ${text}`);
    return;
  }
  try {
    await telegramSend(env, "sendMessage", {
      chat_id: msg.chat.id,
      reply_to_message_id: msg.message_id,
      text,
    });
  } catch (e) {
    process.stderr.write(`[approve] reply send failed: ${e.message}\n`);
  }
}

// ---- act on one parsed command against one matched row ----
async function applyDecision(env, db, row, cmd, msg) {
  if (cmd.action === "approve") {
    // STEP 2: land at 'approved' and stop. YouTube upload is a later step.
    setStatus(db, row.id, "approved", { approved_at: new Date().toISOString() });
    log(`video ${row.id} "${row.title}" approved by human (upload deferred to step 3)`);
    await replyTo(env, msg, `Approved: "${row.title}". Queued for upload.`);
    return;
  }
  if (cmd.action === "reject") {
    // tmp/ assets are intentionally NOT cleaned up on reject (Section 03a).
    setStatus(db, row.id, "rejected", { reject_reason: cmd.reason });
    log(`video ${row.id} "${row.title}" rejected: ${cmd.reason}`);
    await replyTo(env, msg, `Rejected: "${row.title}". Reason: ${cmd.reason}. Assets kept.`);
    return;
  }
}

// ---- process one Telegram update ----
async function processUpdate(env, db, update) {
  const msg = update.message;
  if (!msg || !msg.text || !msg.chat) return; // ignore non-text / non-message updates

  // Only ever act on the configured approval chat. Other chats are ignored, but
  // their update_id is still acknowledged (offset advances) so they don't replay.
  if (String(msg.chat.id) !== String(env.FLYT_CHAT_ID)) {
    log(`ignoring message from unexpected chat ${msg.chat.id}`);
    return;
  }

  const cmd = parseCommand(msg.text);
  if (!cmd) return; // not a command; stay silent (avoid spamming normal chatter)

  const { row, error } = matchRow(db, msg);
  if (error) {
    log(`could not match reply from chat ${msg.chat.id}: ${error}`);
    await replyTo(env, msg, `Could not act on that: ${error}.`);
    return;
  }

  await applyDecision(env, db, row, cmd, msg);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  DRY_RUN = !!args.dryRun;
  const env = loadEnv();

  if (!env.FLYT_BOT_TOKEN || !env.FLYT_CHAT_ID) {
    throw new Error("FLYT_BOT_TOKEN and FLYT_CHAT_ID must be set in ~/.openclaw/.env");
  }

  const dbPath = env.NEWCHANNELS_DB_PATH || "~/OpenClaw/NewChannels/db/tracking.db";
  const db = openDb(dbPath);

  try {
    const offset = loadOffset();
    const updates = await telegramSend(env, "getUpdates", {
      offset,
      timeout: GETUPDATES_TIMEOUT_S,
      allowed_updates: ["message"],
    });

    if (!Array.isArray(updates) || updates.length === 0) {
      log("no new replies");
      return;
    }
    log(`${updates.length} update(s)${DRY_RUN ? " (dry-run: no writes, no replies)" : ""}`);

    let maxUpdateId = offset ? offset - 1 : -1;
    for (const update of updates) {
      if (typeof update.update_id === "number" && update.update_id > maxUpdateId) {
        maxUpdateId = update.update_id;
      }
      try {
        await processUpdate(env, db, update);
      } catch (err) {
        approvalsAlert(`update ${update.update_id} failed`, err.message);
        process.stderr.write(`[approve] update ${update.update_id} error: ${err.message}\n`);
      }
    }

    // Acknowledge everything drained this pass, even updates that were ignored or
    // failed, so a single poison message cannot wedge the queue forever.
    if (maxUpdateId >= 0) saveOffset(maxUpdateId);
    log("pass complete");
  } finally {
    db.close();
  }
}

// Only run a live pass when invoked directly; requiring the module (tests) just
// pulls the pure helpers below without hitting Telegram.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[approve] FATAL: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseCommand, matchRow, applyDecision, setStatus, __setDryRun: (v) => { DRY_RUN = v; } };

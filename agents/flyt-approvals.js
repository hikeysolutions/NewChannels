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
// SCOPE:
//   Reply handling: approve -> status='approved'; reject -> status='rejected'
//     with reject_reason saved, tmp/ assets kept (Section 03a).
//   Upload pass: every 'approved' row is uploaded to YouTube (raw https, see
//     lib/youtube.js) and moved to 'published' with youtube_video_id + cleanup
//     of tmp/ intermediates (Section 03 steps 9-10). This runs every invocation,
//     so a failed upload (e.g. the Section 04a 7-day refresh-token expiry) retries
//     on the next scheduled run instead of being lost.
// DEFERRED (needs real CHANNEL_A_YOUTUBE_* creds + OAuth verification, a separate
//   task): the two live tests — an actual upload, and YouTube honoring
//   status.containsSyntheticMedia. The uploader is fully unit-tested against a
//   mocked HTTP layer; nothing auto-uploads until credentials exist.
//   Bundled grammar: a reply of "approve all|long|short_n" or "reject [item]
//     [reason]" is resolved against the matched bundle (the long-form parent plus
//     its short children). A short_n that isn't in the bundle is a clean no-op
//     with an explanatory reply; already-handled items are skipped silently.
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
const youtube = require("./lib/youtube");

const ROOT = path.resolve(__dirname, "..");
const PYTHON = "python3.11";
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };

// Per-video paths derived from the row's manifest_path, same convention the
// poller uses. The final MP4 to upload lives in the channel's outputs/; the
// intermediate assets to clean up after a confirmed upload live in tmp/<slug>/.
function pathsFor(row) {
  const chDir = path.join(ROOT, CHANNEL_DIRS[row.channel]);
  const slug = path.basename(row.manifest_path || `${row.id}.json`, ".json");
  return {
    slug,
    mp4Path: path.join(chDir, "outputs", `${slug}.mp4`),
    tmpDir: path.join(chDir, "tmp", slug),
  };
}

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
// Bundled grammar (Section 03a v2.7, matching the caption in publish.js):
//   approve all | approve long | approve short_[n]
//   reject [item] [reason]   where item is all | long | short_[n] (optional)
// Returns { action, scope, index, reason } or null. `scope` is 'all' | 'long' |
// 'short'; `index` is the 1-based short number when scope is 'short', else null.
// Bare "approve"/"reject" default to scope 'all' (whole bundle). Unrecognized text
// yields null and a help reply, never a wrong write.

// Parse the item portion after the leading verb into { scope, index }, or null if
// it names no recognized item. An empty item means the whole bundle (scope 'all').
function parseItem(itemToken) {
  if (!itemToken) return { scope: "all", index: null };
  const t = itemToken.toLowerCase();
  if (t === "all") return { scope: "all", index: null };
  if (t === "long") return { scope: "long", index: null };
  // short_[n] or short[n] or "short n" already collapsed to a single token upstream.
  const m = t.match(/^short[_\s]?(\d+)$/);
  if (m) {
    const index = parseInt(m[1], 10);
    if (index >= 1) return { scope: "short", index };
  }
  return null;
}

function parseCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/);
  const verb = tokens[0].toLowerCase();

  if (verb === "approve") {
    // approve | approve all | approve long | approve short_[n]. Anything else is
    // not understood — return null rather than guessing an approval.
    const item = parseItem(tokens[1]);
    if (!item || tokens.length > 2) return null;
    return { action: "approve", scope: item.scope, index: item.index };
  }

  if (verb === "reject") {
    // reject [item] [reason]. If the first token after "reject" names an item,
    // consume it and treat the rest as the reason; otherwise the whole remainder
    // is the reason and the scope defaults to the whole bundle ('all').
    const rest = tokens.slice(1);
    let scope = "all";
    let index = null;
    let reasonTokens = rest;
    if (rest.length > 0) {
      const item = parseItem(rest[0]);
      if (item) {
        scope = item.scope;
        index = item.index;
        reasonTokens = rest.slice(1);
      }
    }
    const reason = reasonTokens.join(" ").trim();
    return { action: "reject", scope, index, reason: reason || "(no reason given)" };
  }

  return null;
}

// ---- bundle resolution ----
// A matched anchor row is the long-form parent (it carries the tg_message_id of
// the bundled message). Resolve the full bundle it belongs to: the long-form row
// plus every short cut from it, ordered by id (short_1 is the earliest child).
// Works even if the anchor is itself a short (defensive): walk up to the parent.
function resolveBundle(db, row) {
  // Always re-read the long-form row fresh so its status reflects any decisions
  // already applied this pass (the caller may hold a stale copy).
  const longId = row.parent_video_id || row.id;
  const longRow = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(longId) || row;
  const shorts = db
    .prepare(`SELECT * FROM videos WHERE parent_video_id = ? AND video_type = 'short' ORDER BY id ASC`)
    .all(longRow.id);
  return { long: longRow, shorts };
}

// Given a parsed command + resolved bundle, return the list of rows the decision
// applies to, or an { error } when the command names something that isn't there
// (e.g. approve short_5 when the bundle has 2 shorts). Never guesses.
function targetsForCommand(cmd, bundle) {
  if (cmd.scope === "long") return { rows: [bundle.long] };
  if (cmd.scope === "all") return { rows: [bundle.long, ...bundle.shorts] };
  if (cmd.scope === "short") {
    const target = bundle.shorts[cmd.index - 1];
    if (!target) {
      const have = bundle.shorts.length;
      return { error: have === 0
        ? "this bundle has no shorts"
        : `no short_${cmd.index} in this bundle (it has ${have})` };
    }
    return { rows: [target] };
  }
  return { error: `unrecognized scope "${cmd.scope}"` };
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

// ---- act on one parsed command against the matched bundle ----
// The command's scope (all|long|short_n) selects which rows in the bundle to act
// on. A short_n that doesn't exist is a clean no-op with an explanatory reply.
async function applyDecision(env, db, row, cmd, msg) {
  const bundle = resolveBundle(db, row);
  const { rows, error } = targetsForCommand(cmd, bundle);
  if (error) {
    log(`cannot ${cmd.action} ${describeScope(cmd)}: ${error}`);
    await replyTo(env, msg, `Could not act on that: ${error}.`);
    return;
  }

  // Only act on rows still awaiting approval; a bundle can be partially handled
  // already (e.g. one short rejected earlier). Silently skip the rest.
  const actionable = rows.filter((r) => r.status === "pending_approval");
  if (actionable.length === 0) {
    log(`${describeScope(cmd)}: nothing left awaiting approval`);
    await replyTo(env, msg, `Nothing to ${cmd.action} there — already handled.`);
    return;
  }

  if (cmd.action === "approve") {
    for (const r of actionable) {
      setStatus(db, r.id, "approved", { approved_at: new Date().toISOString() });
      log(`video ${r.id} "${r.title}" approved by human`);
    }
    const titles = actionable.map((r) => `"${r.title}"`).join(", ");
    await replyTo(env, msg, `Approved ${describeScope(cmd)}: ${titles}. Queued for upload.`);
    return;
  }

  if (cmd.action === "reject") {
    // tmp/ assets are intentionally NOT cleaned up on reject (Section 03a).
    for (const r of actionable) {
      setStatus(db, r.id, "rejected", { reject_reason: cmd.reason });
      log(`video ${r.id} "${r.title}" rejected: ${cmd.reason}`);
    }
    const titles = actionable.map((r) => `"${r.title}"`).join(", ");
    await replyTo(env, msg, `Rejected ${describeScope(cmd)}: ${titles}. Reason: ${cmd.reason}. Assets kept.`);
    return;
  }
}

// Human-readable name for a command's scope, for logs and replies.
function describeScope(cmd) {
  if (cmd.scope === "long") return "the long-form";
  if (cmd.scope === "all") return "the whole bundle";
  if (cmd.scope === "short") return `short_${cmd.index}`;
  return cmd.scope;
}

// ---- upload pass: drive every 'approved' row to 'published' (Section 03 step 9) ----
// Decoupled from the reply handler on purpose: a reply only records the human
// decision (status='approved'); this pass does the actual YouTube upload and runs
// on every invocation, so a transient failure (e.g. the Section 04a 7-day refresh-
// token expiry) simply retries on the next scheduled run instead of being lost.
async function uploadApprovedRow(env, db, row, deps = {}) {
  const uploadForRow = deps.uploadForRow || youtube.uploadForRow;
  const paths = pathsFor(row);

  if (!fs.existsSync(paths.mp4Path)) {
    // The approved video's MP4 is gone; do not fail-loop. Alert and leave at
    // 'approved' for manual review rather than silently churning.
    approvalsAlert(`video ${row.id} (${paths.slug}) approved but MP4 missing`, `expected ${paths.mp4Path}`);
    log(`video ${row.id}: approved but MP4 missing at ${paths.mp4Path} — skipping upload`);
    return;
  }

  if (DRY_RUN) {
    log(`[dry] would upload ${paths.mp4Path} to YouTube and mark video ${row.id} published`);
    return;
  }

  log(`video ${row.id} "${row.title}" — uploading to YouTube (${row.channel})`);
  let result;
  try {
    result = await uploadForRow(env, row, paths.mp4Path, {}, deps);
  } catch (err) {
    // Stays 'approved' so the next pass retries; invalid_grant is the 04a expiry.
    approvalsAlert(`video ${row.id} (${paths.slug}) YouTube upload failed`, err.message);
    log(`video ${row.id}: upload failed (${err.message}) — left at 'approved' for retry`);
    return;
  }

  setStatus(db, row.id, "published", {
    youtube_video_id: result.videoId,
    published_at: new Date().toISOString(),
  });
  log(`video ${row.id} published: ${result.url}`);

  // Cleanup (Section 03 step 10): remove intermediate assets only after a
  // confirmed upload. The final MP4 in outputs/ is the deliverable, kept.
  cleanupTmp(paths, row.id);
}

function cleanupTmp(paths, videoId) {
  if (DRY_RUN) {
    log(`[dry] would remove tmp assets ${paths.tmpDir}`);
    return;
  }
  try {
    if (fs.existsSync(paths.tmpDir)) {
      fs.rmSync(paths.tmpDir, { recursive: true, force: true });
      log(`video ${videoId}: cleaned up ${paths.tmpDir}`);
    }
  } catch (e) {
    // Non-fatal: the upload already succeeded. Just note it.
    process.stderr.write(`[approve] video ${videoId}: tmp cleanup failed: ${e.message}\n`);
  }
}

async function processApprovedUploads(env, db, deps = {}) {
  const rows = db.prepare(`SELECT * FROM videos WHERE status='approved' ORDER BY id ASC`).all();
  if (rows.length === 0) return;
  log(`${rows.length} approved video(s) pending upload`);
  for (const row of rows) {
    try {
      await uploadApprovedRow(env, db, row, deps);
    } catch (err) {
      approvalsAlert(`video ${row.id} upload pass errored`, err.message);
      process.stderr.write(`[approve] video ${row.id} upload pass error: ${err.message}\n`);
    }
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
    // (1) Drain any new Telegram replies and record approve/reject decisions.
    const offset = loadOffset();
    const updates = await telegramSend(env, "getUpdates", {
      offset,
      timeout: GETUPDATES_TIMEOUT_S,
      allowed_updates: ["message"],
    });

    if (!Array.isArray(updates) || updates.length === 0) {
      log("no new replies");
    } else {
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
    }

    // (2) Upload pass: push every 'approved' row to YouTube -> 'published'. Runs
    // every invocation regardless of new replies, so failed uploads retry.
    await processApprovedUploads(env, db);
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

module.exports = {
  parseCommand, parseItem, matchRow, resolveBundle, targetsForCommand,
  applyDecision, setStatus, pathsFor, uploadApprovedRow, processApprovedUploads,
  __setDryRun: (v) => { DRY_RUN = v; },
};

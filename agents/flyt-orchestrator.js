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

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const { loadEnv } = require("./lib/env");
const { openDb } = require("./lib/db");

const ROOT = path.resolve(__dirname, "..");
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };
const PYTHON = "python3.11";

// Section 02 cost estimates. There is no billing API, so per-video cost is
// estimated from unit prices and logged to the videos row (Section 00c).
const STILL_COST_USD = 0.034; // NB2 Lite standard, per image
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

// ---- lightweight QA / accuracy pass (Section 03 step 2). No separate step exists
// in flyt-script-generator.js (confirmed), so this is the second-pass flag version:
// ask the local qwen model to flag unsupported/invented claims, log each to
// qa_flags with category='factual_accuracy'. Flags are LOGGED, never auto-corrected. ----
function qaAccuracyPass(db, videoId, channel, scriptText) {
  const prompt =
    "You are a fact-checker. Read the narration script and list ONLY claims that are " +
    "unsupported, invented, or suspiciously specific (fake dates, invented quotes, made-up " +
    "numbers). Output STRICT JSON: {\"flags\":[{\"claim\":\"...\",\"scene\":\"...\"}]}. " +
    "Empty flags array if nothing is dubious.\n\nSCRIPT:\n" + scriptText;
  const body = JSON.stringify({
    model: "qwen2.5:7b",
    prompt,
    format: "json",
    stream: false,
    options: { temperature: 0.1 },
  });
  let flags = [];
  try {
    const out = execFileSync(
      "curl",
      ["-s", "-m", "60", "http://localhost:11434/api/generate", "-d", body],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(JSON.parse(out).response);
    flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  } catch (err) {
    process.stderr.write(`[orch] QA pass could not run (${err.message}); logging zero flags, continuing\n`);
  }
  const ins = db.prepare(
    `INSERT INTO qa_flags (video_id, channel, flagged_claim, scene_reference, category)
     VALUES (?, ?, ?, ?, 'factual_accuracy')`
  );
  for (const f of flags) {
    if (f && f.claim) ins.run(videoId, channel, String(f.claim), f.scene ? String(f.scene) : null);
  }
  log(`QA pass: ${flags.length} factual_accuracy flag(s) logged`);
  return flags.length;
}

// ---- Cloudinary signed upload (Section 02a). Pure node: signed multipart POST. ----
function cloudinaryUpload(env, filePath, folder, publicId) {
  // Dedicated New Channels account preferred; falls back to the generic set.
  const dedicated = !!env.NEWCHANNELS_CLOUDINARY_CLOUD_NAME;
  const cloud = env.NEWCHANNELS_CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.NEWCHANNELS_CLOUDINARY_API_KEY || env.CLOUDINARY_API_KEY;
  const apiSecret = env.NEWCHANNELS_CLOUDINARY_API_SECRET || env.CLOUDINARY_API_SECRET;
  log(`cloudinary account: ${cloud} (${dedicated ? "dedicated New Channels" : "shared/fallback"})`);
  const timestamp = Math.floor(Date.now() / 1000);

  // Signature = sha1 of alphabetically-sorted signed params + api_secret.
  const signed = { folder, public_id: publicId, timestamp };
  const toSign = Object.keys(signed).sort().map((k) => `${k}=${signed[k]}`).join("&");
  const signature = crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");

  const boundary = "----flyt" + crypto.randomBytes(12).toString("hex");
  const fields = { api_key: apiKey, timestamp, folder, public_id: publicId, signature };
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\n` +
        `Content-Type: video/mp4\r\n\r\n`
    )
  );
  parts.push(fs.readFileSync(filePath));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        host: "api.cloudinary.com",
        path: `/v1_1/${cloud}/video/upload`,
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": payload.length },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            return reject(new Error(`Cloudinary: non-JSON response (HTTP ${res.statusCode})`));
          }
          if (res.statusCode >= 400 || json.error) {
            return reject(new Error(`Cloudinary HTTP ${res.statusCode}: ${json.error ? json.error.message : data.slice(0, 200)}`));
          }
          resolve(json);
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---- Telegram bundled-format message (Section 03a v2.7). Single message per
// production run even for one long-form item, so the v2.7 code path is exercised. ----
function telegramSend(env, method, params) {
  const body = JSON.stringify(params);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        host: "api.telegram.org",
        path: `/bot${env.FLYT_BOT_TOKEN}/${method}`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            return reject(new Error(`Telegram: non-JSON response (HTTP ${res.statusCode})`));
          }
          if (!json.ok) return reject(new Error(`Telegram ${method} failed: ${json.description || data.slice(0, 200)}`));
          resolve(json.result);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function bundledCaption({ title, entity, situation, channel, costTotal, videoUrl, shortCount }) {
  return (
    `🎬 New Channels — approval needed\n\n` +
    `Channel: ${channel}\n` +
    `Title: ${title}\n` +
    `Entity/Situation: ${entity} / ${situation}\n` +
    `Long-form: 1   Shorts: ${shortCount}\n` +
    `Cost: $${costTotal.toFixed(3)}\n\n` +
    `Watch: ${videoUrl}\n\n` +
    `Reply: approve all | approve long | approve short_[n] | reject [item] [reason]`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  if (!preflight(env)) process.exit(2);

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

    // STEP 3 — QA / accuracy pass (Section 03 step 2), log flags, then qa_pending.
    const scriptRel = m[2];
    const scriptText = fs.readFileSync(path.join(ROOT, scriptRel), "utf8");
    qaAccuracyPass(db, videoId, channel, scriptText);
    setStatus(db, videoId, "qa_pending");

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
      cloudinaryUpload(env, mp4Path, `new-channels/${channel}`, slug)
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

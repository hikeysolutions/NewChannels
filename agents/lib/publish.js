"use strict";

// Publish stage (Section 02a/03a): Cloudinary upload + Telegram bundled approval
// message. Extracted from the orchestrator so BOTH the synchronous path (Channel
// B / legacy) and the Phase-2 cron poller (Channel A async stills) share one
// implementation instead of duplicating signed-upload and Telegram logic.

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

// ---- Cloudinary signed upload. Pure node: signed multipart POST. ----
function cloudinaryUpload(env, filePath, folder, publicId, log = () => {}) {
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

// ---- Telegram Bot API call (Section 03a). ----
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

// ---- The bundled approval caption (Section 03a v2.7). ----
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

module.exports = { cloudinaryUpload, telegramSend, bundledCaption };

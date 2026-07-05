"use strict";

// youtube.js - raw-https YouTube Data API v3 uploader (Section 03 step 9).
// No googleapis dependency: OAuth token refresh and the resumable videos.insert
// are done with the stdlib https module, matching how publish.js talks to
// Telegram and image_providers.py talks to Gemini. Nothing here touches the DB or
// Telegram; the caller (flyt-approvals.js) owns state transitions and messaging.
//
// Every network call goes through an injectable `request` function so the whole
// module is unit-testable against a mocked HTTP layer with no real credentials.
// The two live behaviours that CANNOT be verified without real CHANNEL_A_YOUTUBE_*
// credentials + OAuth verification (an actual upload, and YouTube actually honoring
// status.containsSyntheticMedia) are DEFERRED — see the deferred-test note in the
// unit tests. containsSyntheticMedia is a real, writable API field as of the
// 2024-10-30 Data API revision, so it is set here unconditionally for this
// synthetic-media pipeline.

const fs = require("fs");
const https = require("https");

// Per-channel OAuth credential prefix. The .env template (Section 00d) isolates
// only the YouTube credential set per channel; everything else is shared.
const CHANNEL_ENV_PREFIX = { channel_a: "CHANNEL_A_", channel_b: "CHANNEL_B_" };

// YouTube category id. 27 = Education, fits Channel A's historical-curiosity format.
const DEFAULT_CATEGORY_ID = "27";

// Default privacy for an approved upload. A human has already approved it at the
// Telegram gate, so 'public' is the intent; overridable via env for safety.
const DEFAULT_PRIVACY_STATUS = "public";

// ---- default HTTP layer (swapped for a mock in tests) ----
// Resolves to { statusCode, headers, body } where body is a UTF-8 string.
// `body` in the request may be a string or a Buffer.
function defaultRequest({ method, hostname, path: reqPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname, path: reqPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

// ---- OAuth: refresh -> short-lived access token ----
// Google issues 7-day-expiring refresh tokens for OAuth apps still in "Testing"
// status (Section 04a). A refused refresh (invalid_grant) is that expiry: it is
// surfaced with a recognizable message so the caller can alert rather than treat
// the row as permanently failed.
async function refreshAccessToken(env, channel, deps = {}) {
  const request = deps.request || defaultRequest;
  const prefix = CHANNEL_ENV_PREFIX[channel];
  if (!prefix) throw new Error(`youtube: unknown channel "${channel}"`);

  const clientId = env[`${prefix}YOUTUBE_CLIENT_ID`];
  const clientSecret = env[`${prefix}YOUTUBE_CLIENT_SECRET`];
  const refreshToken = env[`${prefix}YOUTUBE_REFRESH_TOKEN`];
  const missing = [];
  if (!clientId) missing.push(`${prefix}YOUTUBE_CLIENT_ID`);
  if (!clientSecret) missing.push(`${prefix}YOUTUBE_CLIENT_SECRET`);
  if (!refreshToken) missing.push(`${prefix}YOUTUBE_REFRESH_TOKEN`);
  if (missing.length) {
    throw new Error(`youtube: missing OAuth credentials in env: ${missing.join(", ")} (see Section 04a)`);
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }).toString();

  const res = await request({
    method: "POST",
    hostname: "oauth2.googleapis.com",
    path: "/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form) },
    body: form,
  });

  let json;
  try {
    json = JSON.parse(res.body);
  } catch (_) {
    throw new Error(`youtube: token endpoint returned non-JSON (HTTP ${res.statusCode})`);
  }
  if (res.statusCode !== 200 || !json.access_token) {
    // invalid_grant here is the expected 7-day refresh-token expiry (Section 04a).
    const tag = json.error === "invalid_grant" ? " [refresh token expired — re-auth per Section 04a]" : "";
    throw new Error(`youtube: token refresh failed (HTTP ${res.statusCode}): ${json.error || res.body.slice(0, 200)}${tag}`);
  }
  return json.access_token;
}

// ---- request-body builder (pure; easy to assert in tests) ----
// title comes straight from the row (already the locked formula from Section 01).
function buildMetadata(row, opts = {}) {
  const description =
    opts.description ||
    `${row.title}\n\n` +
      `A short look at ${row.entity} — ${row.situation}.\n\n` +
      `This video contains AI-assisted, synthetic visuals and narration.`;
  const tags = opts.tags || [row.entity, row.situation, "history", "historical", "before now"].filter(Boolean);

  return {
    snippet: {
      title: row.title,
      description,
      tags,
      categoryId: opts.categoryId || DEFAULT_CATEGORY_ID,
    },
    status: {
      privacyStatus: opts.privacyStatus || DEFAULT_PRIVACY_STATUS,
      selfDeclaredMadeForKids: false, // Not Made for Kids (Section 03 step 9)
      containsSyntheticMedia: true, // altered/synthetic disclosure (Data API 2024-10-30)
    },
  };
}

// ---- resumable videos.insert ----
// Two legs: (1) POST metadata to open a resumable session, read the session URL
// from the Location header; (2) PUT the file bytes to that URL. Returns the new
// video id. The file is read into memory (Channel A outputs are short MP4s).
async function uploadVideo({ accessToken, filePath, metadata }, deps = {}) {
  const request = deps.request || defaultRequest;
  const fileBuf = deps.fileBuffer || fs.readFileSync(filePath);
  const metaBody = JSON.stringify(metadata);

  // Leg 1 — open resumable session.
  const initRes = await request({
    method: "POST",
    hostname: "www.googleapis.com",
    path: "/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "Content-Length": Buffer.byteLength(metaBody),
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": fileBuf.length,
    },
    body: metaBody,
  });
  if (initRes.statusCode !== 200) {
    throw new Error(`youtube: resumable init failed (HTTP ${initRes.statusCode}): ${String(initRes.body).slice(0, 300)}`);
  }
  const sessionUrl = initRes.headers.location || initRes.headers.Location;
  if (!sessionUrl) throw new Error("youtube: resumable init returned no upload URL (missing Location header)");

  // Leg 2 — PUT the bytes to the session URL. Parse host + path from it.
  const u = new URL(sessionUrl);
  const putRes = await request({
    method: "PUT",
    hostname: u.hostname,
    path: `${u.pathname}${u.search}`,
    headers: { "Content-Type": "video/mp4", "Content-Length": fileBuf.length },
    body: fileBuf,
  });
  if (putRes.statusCode !== 200 && putRes.statusCode !== 201) {
    throw new Error(`youtube: upload PUT failed (HTTP ${putRes.statusCode}): ${String(putRes.body).slice(0, 300)}`);
  }

  let resource;
  try {
    resource = JSON.parse(putRes.body);
  } catch (_) {
    throw new Error(`youtube: upload succeeded but response was not JSON: ${String(putRes.body).slice(0, 200)}`);
  }
  if (!resource.id) throw new Error(`youtube: upload response had no video id: ${String(putRes.body).slice(0, 200)}`);
  return { id: resource.id, resource };
}

// ---- one-call convenience: refresh + build + upload ----
async function uploadForRow(env, row, filePath, opts = {}, deps = {}) {
  const accessToken = await refreshAccessToken(env, row.channel, deps);
  const metadata = buildMetadata(row, opts);
  const { id } = await uploadVideo({ accessToken, filePath, metadata }, deps);
  return { videoId: id, url: `https://youtu.be/${id}` };
}

module.exports = {
  refreshAccessToken,
  buildMetadata,
  uploadVideo,
  uploadForRow,
  defaultRequest,
  CHANNEL_ENV_PREFIX,
  DEFAULT_CATEGORY_ID,
  DEFAULT_PRIVACY_STATUS,
};

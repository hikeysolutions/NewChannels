"use strict";

// Validation and shaping for the scene manifest produced by stage 2. Fail fast
// at the system boundary: qwen output is external data and is never trusted
// (coding-style: validate all input at boundaries).

const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };

function channelDir(channel) {
  const dir = CHANNEL_DIRS[channel];
  if (!dir) throw new Error(`unknown channel "${channel}" (expected channel_a or channel_b)`);
  return dir;
}

// Turn a title into a filesystem-safe slug.
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

// Validate the qwen scene object and return a normalized manifest. Throws with
// a specific message on the first problem found.
function validateScenes(sceneObj) {
  if (!sceneObj || typeof sceneObj !== "object") {
    throw new Error("manifest is not an object");
  }
  const scenes = sceneObj.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("manifest.scenes must be a non-empty array");
  }

  let heroCount = 0;
  let expectedStart = 0;

  scenes.forEach((scene, i) => {
    const at = `scene[${i}]`;
    if (typeof scene.start !== "number" || typeof scene.end !== "number") {
      throw new Error(`${at}: start and end must be numbers`);
    }
    if (scene.end <= scene.start) {
      throw new Error(`${at}: end (${scene.end}) must be greater than start (${scene.start})`);
    }
    if (scene.start !== expectedStart) {
      throw new Error(`${at}: start ${scene.start} is not contiguous (expected ${expectedStart})`);
    }
    if (scene.asset_type !== "still" && scene.asset_type !== "hero") {
      throw new Error(`${at}: asset_type must be "still" or "hero" (got "${scene.asset_type}")`);
    }
    if (typeof scene.narration !== "string" || scene.narration.trim() === "") {
      throw new Error(`${at}: narration must be a non-empty string`);
    }
    // visual_prompt feeds the stills/hero generators (flyt-stills.py, Seedance
    // wrapper). qwen's JSON contract declares it, but a missing/empty value must
    // fail here at the source, not silently break generation downstream.
    if (typeof scene.visual_prompt !== "string" || scene.visual_prompt.trim() === "") {
      throw new Error(`${at}: visual_prompt must be a non-empty string`);
    }
    // on_screen_text is the assembly-stage caption; empty string is allowed
    // (qwen returns "" when a scene has no caption) but it must be present.
    if (typeof scene.on_screen_text !== "string") {
      throw new Error(`${at}: on_screen_text must be a string (empty string allowed)`);
    }
    if (scene.asset_type === "hero") heroCount += 1;
    expectedStart = scene.end;
  });

  if (heroCount < 1 || heroCount > 2) {
    throw new Error(`expected 1-2 hero scenes, got ${heroCount}`);
  }

  return { scenes, totalDurationSeconds: expectedStart, heroCount };
}

module.exports = { channelDir, slugify, validateScenes, CHANNEL_DIRS };

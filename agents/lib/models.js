"use strict";

// JS-side reader for the image-model registry (config/image-models.json) and the
// per-channel selection (ChannelX/config.json). Mirror of the Python resolver in
// agents/lib/image_providers.py so both languages read ONE source of truth.
// Used by the orchestrator for cost tracking (cost follows the model, no hardcode).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };
const REGISTRY_PATH = path.join(ROOT, "config", "image-models.json");
const DEFAULT_IMAGE_MODEL = "gemini-nb2-batch";

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

// Which image model a channel uses. Reads ChannelX/config.json "image_model";
// falls back to DEFAULT_IMAGE_MODEL when the file or key is absent/unreadable, so
// a channel with no config.json keeps today's behavior.
function resolveImageModel(channel) {
  const cfgPath = path.join(ROOT, CHANNEL_DIRS[channel] || "", "config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg && typeof cfg.image_model === "string" && cfg.image_model.trim()) {
        return cfg.image_model.trim();
      }
    } catch (_) {
      /* unreadable/invalid -> fall through to default */
    }
  }
  return DEFAULT_IMAGE_MODEL;
}

// The resolved registry spec for a channel's image model ({ id, ...spec }).
function imageModel(channel) {
  const id = resolveImageModel(channel);
  const spec = loadRegistry()[id];
  if (!spec) throw new Error(`image model '${id}' not in ${REGISTRY_PATH}`);
  return { id, ...spec };
}

function costPerImageUsd(channel) {
  return Number(imageModel(channel).cost_per_image_usd || 0);
}

module.exports = { resolveImageModel, imageModel, costPerImageUsd, DEFAULT_IMAGE_MODEL };

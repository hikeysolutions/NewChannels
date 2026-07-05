"use strict";

// LLM provider registry (config/llm-models.json) + per-channel provider ORDER.
// Sibling of the image-model registry (config/image-models.json via models.js):
// one config file is the single source of truth, so adding, removing, or
// reordering script-generation providers is a config edit, never a code change
// across groq.js and its callers.
//
// The image registry selects ONE model per channel; scripts want an ordered
// fallback CHAIN (primary, then fallback...), so a channel selects a LIST via
// ChannelX/config.json "llm_providers". Absent that key, DEFAULT_LLM_ORDER holds
// today's behavior (Groq primary, Cerebras fallback).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CHANNEL_DIRS = { channel_a: "ChannelA", channel_b: "ChannelB" };
const REGISTRY_PATH = path.join(ROOT, "config", "llm-models.json");
const DEFAULT_LLM_ORDER = ["groq", "cerebras"];

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

// The ordered provider ids a channel uses. Reads ChannelX/config.json
// "llm_providers" (an array of ids); falls back to DEFAULT_LLM_ORDER when the
// file, the key, or a valid array is absent, so a channel with no config keeps
// today's Groq-then-Cerebras order.
function resolveLlmProviders(channel) {
  const cfgPath = path.join(ROOT, CHANNEL_DIRS[channel] || "", "config.json");
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (Array.isArray(cfg.llm_providers) && cfg.llm_providers.length) {
        const ids = cfg.llm_providers.filter((x) => typeof x === "string" && x.trim());
        if (ids.length) return ids.map((x) => x.trim());
      }
    } catch (_) {
      /* unreadable/invalid -> fall through to default order */
    }
  }
  return [...DEFAULT_LLM_ORDER];
}

// The registry spec for one provider id ({ id, ...spec }).
function llmProvider(id) {
  const spec = loadRegistry()[id];
  if (!spec) throw new Error(`llm provider '${id}' not in ${REGISTRY_PATH}`);
  return { id, ...spec };
}

// First present auth key for a provider spec, from a merged env object. Returns
// null when none of the provider's auth_env vars are set, so the chain can skip
// an unconfigured provider and fall through to the next.
function resolveKey(spec, env) {
  for (const name of spec.auth_env || []) {
    const val = env[name];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

// The resolved, ordered call chain for a channel: each entry is the provider
// spec plus its resolved apiKey (null when unconfigured). Callers iterate this
// in order, trying each configured provider until one succeeds.
function resolveChain(channel, env) {
  return resolveLlmProviders(channel).map((id) => {
    const spec = llmProvider(id);
    return { ...spec, apiKey: resolveKey(spec, env) };
  });
}

module.exports = {
  loadRegistry,
  resolveLlmProviders,
  llmProvider,
  resolveKey,
  resolveChain,
  DEFAULT_LLM_ORDER,
};

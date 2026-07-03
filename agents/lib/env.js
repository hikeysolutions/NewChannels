"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Expand a leading ~ to the user's home directory.
function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Parse a .env file into a plain object. Never mutates process.env directly,
// so callers stay in control of precedence.
function parseEnvFile(filePath) {
  const resolved = expandHome(filePath);
  if (!fs.existsSync(resolved)) return {};

  const out = {};
  const lines = fs.readFileSync(resolved, "utf8").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching quotes and drop trailing inline comments
    // on unquoted values.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

// Load ~/.openclaw/.env and return a merged view where a real process.env
// value always wins over the file. Returns a new object; nothing is mutated.
function loadEnv(envPath = "~/.openclaw/.env") {
  const fileEnv = parseEnvFile(envPath);
  // Overlay process.env, but never let an empty / whitespace-only value clobber
  // a real file value. A shell that exports KEY= (empty) must not silently beat
  // the .env file; a genuinely-set exported value still wins as before.
  const merged = { ...fileEnv };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value.trim() !== "") merged[key] = value;
  }
  return merged;
}

module.exports = { loadEnv, parseEnvFile, expandHome };

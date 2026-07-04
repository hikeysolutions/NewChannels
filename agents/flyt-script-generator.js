#!/usr/bin/env node
"use strict";

// flyt-script-generator.js - Session 1
// Shared across both channels, parameterized by --channel (Section 03c).
// Format + entity bank + situation -> prose script (Groq/Cerebras) -> scene JSON (qwen).
//
// Usage:
//   node agents/flyt-script-generator.js --channel channel_a
//   node agents/flyt-script-generator.js --channel channel_a --entity "Vikings" --situation "during war"
//   node agents/flyt-script-generator.js --channel channel_a --dry-run

const fs = require("fs");
const path = require("path");

const { loadEnv, expandHome } = require("./lib/env");
const { openDb, pickCombo, insertVideo, markComboUsed } = require("./lib/db");
const { generateScript } = require("./lib/groq");
const { toSceneJson, regenerateVisualPrompt } = require("./lib/qwen");
const { channelDir, slugify, validateScenes, normalizeScenes } = require("./lib/manifest");
const { repairVisualPrompts } = require("./lib/vpcheck");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--channel") args.channel = argv[++i];
    else if (a === "--entity") args.entity = argv[++i];
    else if (a === "--situation") args.situation = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
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

function readStyleGuide(channel) {
  const guidePath = path.join(ROOT, channelDir(channel), "STYLE_GUIDE.md");
  if (!fs.existsSync(guidePath)) {
    throw new Error(`missing style guide: ${guidePath}`);
  }
  return fs.readFileSync(guidePath, "utf8");
}

// Stage 2 with retry-then-alert (Section 03 step 6). Each attempt runs qwen, then
// a deterministic normalizer (fixes adjacent gap_type repeats + hero count without
// a fresh regen), then strict validation. The normalizer means the structural
// slips rarely reach validation at all; the extra attempts cover the remaining
// stochastic failures (bad render vocab, non-contiguous timings, etc.).
const SCENE_JSON_ATTEMPTS = 3;

async function sceneJsonWithRetry(input, attempts = SCENE_JSON_ATTEMPTS) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return validateScenes(normalizeScenes(await toSceneJson(input)));
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        process.stderr.write(
          `[warn] scene JSON attempt ${attempt}/${attempts} failed: ${err.message}\n[warn] retrying...\n`
        );
      }
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  const styleGuide = readStyleGuide(args.channel);
  const dbPath = env.NEWCHANNELS_DB_PATH || "~/OpenClaw/NewChannels/db/tracking.db";
  const db = openDb(dbPath);

  try {
    const combo = pickCombo(db, args.channel, args.entity, args.situation);
    process.stdout.write(`[info] channel=${args.channel} entity="${combo.entity}" situation="${combo.situation}"\n`);

    process.stdout.write("[info] stage 1: Groq (Cerebras fallback) writing prose script...\n");
    const { title, scriptText, provider } = await generateScript({
      groqKey: env.NEWCHANNELS_GROQ_API_KEY || env.GROQ_API_KEY,
      cerebrasKey: env.CEREBRAS_API_KEY,
      channel: args.channel,
      styleGuide,
      entity: combo.entity,
      situation: combo.situation,
    });
    process.stdout.write(`[info] title: ${title} (via ${provider})\n`);

    process.stdout.write("[info] stage 2: qwen2.5:7b converting to scene JSON...\n");
    const validated = await sceneJsonWithRetry({
      title,
      entity: combo.entity,
      situation: combo.situation,
      channel: args.channel,
      scriptText,
    });
    process.stdout.write(
      `[info] ${validated.scenes.length} scenes, ${validated.heroCount} hero, ~${validated.totalDurationSeconds}s\n`
    );

    // Deterministic visual_prompt gate (vpcheck): the prose-craft slips qwen keeps
    // making (non-visual/audio cues, reused action clauses, near-identical scenes)
    // are not caught by structural validation, so we audit + regenerate only the
    // offending scenes here. Anything that survives the repair budget is stamped
    // scene.qa_flags for the human approval gate rather than shipped silently.
    const repair = await repairVisualPrompts(validated.scenes, {
      regenerate: ({ scene, avoid, otherPrompts }) =>
        regenerateVisualPrompt({
          scene,
          avoid,
          otherPrompts,
          channel: args.channel,
          entity: combo.entity,
          situation: combo.situation,
        }),
      maxAttempts: 2,
    });
    validated.scenes = repair.scenes;
    if (repair.repaired.length || repair.flagged.length) {
      process.stdout.write(
        `[info] vpcheck: repaired ${repair.repaired.length} scene(s)` +
          (repair.flagged.length ? `, qa_flagged ${repair.flagged.length} (scenes ${repair.flagged.join(", ")})` : "") +
          "\n"
      );
    }

    const slug = slugify(title);
    const dir = channelDir(args.channel);
    const scriptRel = path.join(dir, "scripts", `${slug}.md`);
    const manifestRel = path.join(dir, "manifests", `${slug}.json`);

    const manifest = {
      channel: args.channel,
      entity: combo.entity,
      situation: combo.situation,
      title,
      total_duration_seconds: validated.totalDurationSeconds,
      scenes: validated.scenes,
    };

    if (args.dryRun) {
      process.stdout.write("[dry-run] no files written, no DB row inserted\n");
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }

    fs.writeFileSync(
      path.join(ROOT, scriptRel),
      `# ${title}\n\n${scriptText}\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(ROOT, manifestRel),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const videoId = insertVideo(db, {
      channel: args.channel,
      entity: combo.entity,
      situation: combo.situation,
      title,
      script_path: scriptRel,
      manifest_path: manifestRel,
    });
    markComboUsed(db, args.channel, combo.entity, combo.situation);

    process.stdout.write(`[done] video id ${videoId} -> ${scriptRel} + ${manifestRel} (status=scripting)\n`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[error] ${err.message}\n`);
  process.exitCode = 1;
});

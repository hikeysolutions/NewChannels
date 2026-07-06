"use strict";

// Offline unit tests for the Stage-2 cut-point path: lossless segmentation,
// deterministic narration reconstruction from sentence ranges, and the
// validateScenes coverage safety net. No network — pure functions only.

const assert = require("assert");
const {
  toCanonicalNarration,
  splitSentences,
  normalizeForCompare,
} = require("../agents/lib/script_segments");
const { reconstructScenes } = require("../agents/lib/scene_json");
const { validateScenes, normalizeScenes } = require("../agents/lib/manifest");

let pass = 0;
function check(name, fn) {
  fn();
  pass += 1;
  console.log(`  PASS  ${name}`);
}

// --- script_segments ---------------------------------------------------------
check("splitSentences is lossless (join === input)", () => {
  const t = 'One sentence. Two! Three? A "quoted." end. No terminal tail';
  assert.strictEqual(splitSentences(t).join(""), t);
});

check("toCanonicalNarration strips heading + bold beat labels", () => {
  const raw = "# Title Here\n\n**Hook**  \nWhat happened?\n\n**Setup**  \nIt began.";
  const c = toCanonicalNarration(raw);
  assert.ok(!/\*\*/.test(c), "no ** markers remain");
  assert.ok(!/Title Here/.test(c), "heading removed");
  assert.strictEqual(c, "What happened? It began.");
});

// --- reconstructScenes --------------------------------------------------------
const segs = splitSentences("Alpha one. Beta two. Gamma three. Delta four.");

check("reconstruct slices exact narration + contiguous timing", () => {
  const raw = {
    scenes: [
      { index: 1, sentence_start: 1, sentence_end: 2, gap_state: "opens" },
      { index: 2, sentence_start: 3, sentence_end: 4, gap_state: "resolves" },
    ],
  };
  const { scenes } = reconstructScenes(raw.scenes, segs);
  assert.strictEqual(scenes.length, 2);
  assert.strictEqual(scenes[0].narration, "Alpha one. Beta two.");
  assert.strictEqual(scenes[1].narration, "Gamma three. Delta four.");
  // no leftover range fields
  assert.strictEqual(scenes[0].sentence_start, undefined);
  // timing contiguous, monotonic, integer, end>start
  assert.strictEqual(scenes[0].start, 0);
  assert.strictEqual(scenes[1].start, scenes[0].end);
  assert.ok(scenes[0].end > scenes[0].start);
  // full-narration concat equals the source
  const concat = normalizeForCompare(scenes.map((s) => s.narration).join(" "));
  assert.strictEqual(concat, normalizeForCompare(segs.join("")));
});

check("reconstruct rejects a gap in coverage", () => {
  const raw = [
    { sentence_start: 1, sentence_end: 1 },
    { sentence_start: 3, sentence_end: 4 }, // skips sentence 2
  ];
  assert.throws(() => reconstructScenes(raw, segs), /not contiguous/);
});

check("reconstruct rejects incomplete coverage (missing tail)", () => {
  const raw = [{ sentence_start: 1, sentence_end: 3 }]; // leaves sentence 4
  assert.throws(() => reconstructScenes(raw, segs), /cover sentences/);
});

check("reconstruct rejects out-of-range sentence_end", () => {
  const raw = [{ sentence_start: 1, sentence_end: 9 }];
  assert.throws(() => reconstructScenes(raw, segs), /exceeds sentence count/);
});

// --- validateScenes coverage assertion ---------------------------------------
function goodScene(over) {
  return {
    start: 0,
    end: 3,
    asset_type: "still",
    narration: "x",
    visual_prompt: "wide shot, one figure, chipping a stone, firelight",
    on_screen_text: "",
    gap_type: "new_fact",
    gap_state: "opens",
    render: { era: "medieval", location: "a field", subject_type: "period_people", style: "channel_default" },
    ...over,
  };
}

check("validateScenes passes when narration concat equals reference", () => {
  const obj = {
    scenes: [
      goodScene({ start: 0, end: 2, narration: "Hello world." }),
      goodScene({ start: 2, end: 4, narration: "Second line.", gap_type: "escalation", gap_state: "resolves" }),
    ],
  };
  const ref = "Hello world. Second line.";
  const out = validateScenes(normalizeScenes(obj, "channel_a"), "channel_a", ref);
  assert.strictEqual(out.scenes.length, 2);
});

check("validateScenes HARD-FAILS when narration drops content", () => {
  const obj = {
    scenes: [
      goodScene({ start: 0, end: 2, narration: "Hello world." }),
      goodScene({ start: 2, end: 4, narration: "Second line.", gap_type: "escalation", gap_state: "resolves" }),
    ],
  };
  const ref = "Hello world. Second line. A third dropped sentence.";
  assert.throws(
    () => validateScenes(normalizeScenes(obj, "channel_a"), "channel_a", ref),
    /narration coverage mismatch/
  );
});

check("normalizeScenes coerces an invalid gap_type (state leaked into type slot)", () => {
  const obj = {
    scenes: [
      goodScene({ start: 0, end: 2, narration: "a.", gap_type: "new_fact", gap_state: "opens" }),
      // model dropped a gap_STATE value into gap_type — must be repaired, not thrown
      goodScene({ start: 2, end: 4, narration: "b.", gap_type: "resolves", gap_state: "partial_resolve" }),
      goodScene({ start: 4, end: 6, narration: "c.", gap_type: "escalation", gap_state: "resolves" }),
    ],
  };
  const norm = normalizeScenes(obj, "channel_a");
  const { GAP_TYPES_OK } = { GAP_TYPES_OK: ["new_fact", "contradiction", "escalation", "reframing", "hidden_implication", "anomaly", "causal_fragment", "perspective_shift"] };
  assert.ok(GAP_TYPES_OK.includes(norm.scenes[1].gap_type), "invalid gap_type replaced with a valid one");
  assert.notStrictEqual(norm.scenes[1].gap_type, norm.scenes[0].gap_type, "differs from previous");
  assert.notStrictEqual(norm.scenes[1].gap_type, norm.scenes[2].gap_type, "differs from next");
  // and it now passes validation without throwing
  validateScenes(norm, "channel_a");
});

check("validateScenes skips coverage check when no reference given", () => {
  const obj = { scenes: [goodScene({ start: 0, end: 2, narration: "anything at all." })] };
  const out = validateScenes(normalizeScenes(obj, "channel_a"), "channel_a");
  assert.strictEqual(out.scenes.length, 1);
});

console.log(`\n${pass} checks passed`);

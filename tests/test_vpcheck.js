"use strict";

// Deterministic tests for vpcheck.js — no network, no spend. Fixtures are the
// ACTUAL failing outputs from the last live test round (Run 2 byte-identical
// scenes + scent/whispering/crackling leaks; Run 4 warmth + reused clauses).

const assert = require("assert");
const {
  findNonVisual,
  firstFraming,
  auditVisualPrompts,
  repairVisualPrompts,
} = require("../agents/lib/vpcheck");

function scene(visual_prompt, extra = {}) {
  return { asset_type: "still", narration: "n", visual_prompt, ...extra };
}

let passed = 0;
function ok(name) { passed += 1; process.stdout.write(`  ok  ${name}\n`); }

// ---- 1. non-visual keyword detection (the regex that missed "drumbeats") ----
assert.strictEqual(findNonVisual("low-angle close-up of a crackling fire"), "crackling");
// "rhythm of drumbeats" — leftmost banned term wins; both are non-visual
assert.ok(["rhythm", "drumbeats"].includes(findNonVisual("rhythm of drumbeats filling the night air")));
assert.strictEqual(findNonVisual("a steady beat of drumbeats"), "drumbeats");
assert.strictEqual(findNonVisual("the night air carrying the scent of earth"), "scent");
assert.strictEqual(findNonVisual("the warmth of the flames casting soft shadows"), "warmth");
assert.strictEqual(findNonVisual("one person whispering a story"), "whispering");
assert.strictEqual(findNonVisual("the world growing silent"), "silent");
// must NOT false-positive on legitimately visual words
assert.strictEqual(findNonVisual("faces lit by a warm glow of firelight"), null);
assert.strictEqual(findNonVisual("a cold tundra under pale moonlight"), null);
ok("non-visual keyword detection (incl. drumbeats/scent/warmth; no warm/cold FP)");

// ---- 2. framing extraction ----
assert.strictEqual(firstFraming("wide establishing shot, small group of five"), "wide establishing");
assert.strictEqual(firstFraming("over-the-shoulder view of two figures"), "over-the-shoulder");
ok("framing extraction (longest-match)");

// ---- 3. audit catches Run 2's exact failure: byte-identical scenes ----
const dup = "low-angle close-up of hands carefully laying a body on the ground before the fire goes out, the night air carrying the scent of earth into the afterlife, faces illuminated by the last flickers of light";
const run2 = {
  scenes: [
    scene("low-angle close-up of people huddled around a crackling fire, hands reaching for tools and skins laid out nearby"),
    scene("wide establishing shot of vast landscapes under starry night skies"),
    scene("low-angle close-up of people gathered around a central fire, hands reaching for tools and skins laid out nearby, one person whispering a story while others listen intently"),
    scene("medium shot of people standing guard, one person looking back at the fire where others are singing"),
    scene("close-up of hands sharpening tools on a stone blade"),
    scene(dup),
    scene(dup),
    scene(dup),
    scene(dup),
  ],
};
const a2 = auditVisualPrompts(run2.scenes);
const types2 = new Set(a2.issues.map((i) => i.type));
assert.ok(types2.has("non_visual"), "should flag non_visual (crackling/scent/whispering/singing)");
assert.ok(types2.has("clause_reuse"), "should flag reused action clauses");
assert.ok(types2.has("near_duplicate"), "should flag near-identical scenes 6/7/8");
// scenes 6,7,8 are identical to 5 -> each later one flagged as near_duplicate
const nearDupIdx = new Set(a2.issues.filter((i) => i.type === "near_duplicate").map((i) => i.index));
[6, 7, 8].forEach((i) => assert.ok(nearDupIdx.has(i), `scene ${i} must be near_duplicate-flagged`));
ok("audit catches Run 2 (non_visual + clause_reuse + byte-identical near_duplicate)");

// ---- 4. repair resolves everything with a competent mock (no spend) ----
let calls = 0;
const uniqueMock = async ({ index, otherPrompts }) => {
  calls += 1;
  // Competent, neighbour-aware: pick a framing that no other current prompt uses
  // (mirrors what the real qwen regen is told via otherPrompts), plus per-scene
  // distinct vocabulary so nothing collides and no non-visual terms appear.
  const shots = ["overhead top-down view", "medium shot", "over-the-shoulder view", "aerial vantage", "side profile", "high-angle vantage", "extreme close-up", "silhouette framing", "low-angle worm's-eye view"];
  const used = new Set((otherPrompts || []).map(firstFraming).filter(Boolean));
  const framing = shots.find((s) => !used.has(firstFraming(s))) || shots[index % shots.length];
  const subjects = ["lone hunter", "twin sisters", "elderly elder", "young scout", "bearded chieftain", "small child", "seated weaver", "standing sentinel", "kneeling tracker"];
  const acts = ["knapping obsidian flakes", "braiding sinew cordage", "kindling dry tinder", "notching a spear haft", "grinding red ochre", "stacking river cobbles", "stretching a deer hide", "plucking wild grain", "coiling a woven basket"];
  const light = ["dawn backlight", "amber dusk", "firelight from below", "deep umber shadow", "azure predawn", "golden noon overhead", "verdant canopy dapple", "ember flicker", "argent starlight"];
  return `${framing}, ${subjects[index]} ${acts[index]}, ${light[index]}`;
};
(async () => {
  const r = await repairVisualPrompts(run2.scenes, { regenerate: uniqueMock, maxAttempts: 2 });
  const after = auditVisualPrompts(r.scenes);
  assert.strictEqual(after.issues.length, 0, `all issues resolved, got ${JSON.stringify(after.issues)}`);
  assert.strictEqual(r.flagged.length, 0, "nothing left to qa_flag when mock succeeds");
  assert.ok(r.repaired.length > 0, "repaired list is populated");
  assert.ok(calls > 0, "regenerate was actually called");
  // inputs untouched (immutability)
  assert.strictEqual(run2.scenes[6].visual_prompt, dup, "input scenes not mutated");
  assert.ok(!("qa_flags" in run2.scenes[6]), "input scene not stamped");
  ok("repair with competent mock clears every defect, no mutation");

  // ---- 5. stubborn mock (returns junk) -> qa_flags stamped, never silent ----
  const stubbornMock = async () => dup; // always returns the same duplicate/leaky text
  const r2 = await repairVisualPrompts(run2.scenes, { regenerate: stubbornMock, maxAttempts: 2 });
  assert.ok(r2.flagged.length > 0, "unresolved scenes must be qa_flagged");
  r2.flagged.forEach((i) => {
    assert.ok(Array.isArray(r2.scenes[i].qa_flags) && r2.scenes[i].qa_flags.length > 0, `scene ${i} carries qa_flags`);
    assert.strictEqual(r2.scenes[i].qa_flags[0].category, "visual_prompt");
    assert.strictEqual(r2.scenes[i].qa_flags[0].resolution, "pending");
  });
  ok("stubborn mock -> qa_flags stamped (nothing shipped silently)");

  // ---- 6. throwing regenerate (transport failure) still qa_flags, no crash ----
  const throwingMock = async () => { throw new Error("ollama down"); };
  const r3 = await repairVisualPrompts(run2.scenes, { regenerate: throwingMock, maxAttempts: 2 });
  assert.ok(r3.flagged.length > 0, "transport failure falls through to qa_flag");
  ok("regenerate transport failure -> qa_flag (graceful)");

  process.stdout.write(`\n${passed} checks passed\n`);
})().catch((e) => { console.error("TEST FAILED:", e.message); process.exit(1); });

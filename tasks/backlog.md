# New Channels — Backlog (scoped follow-ups, NOT yet built)

Items here are agreed but deliberately deferred. Do not start one without confirming it's the current task.

---

## [queued 2026-07-05] vpcheck regenerate — repeated framing phrases survive repair

**Problem.** On the first live Channel A run (Aztecs / before a wedding, 48 shots) the vpcheck repair loop left 9 shots qa_flagged after repair. Most residual flags were the SAME stock framing phrase — "over-the-shoulder wide establishing shot" — recurring across 5 shots (26, 28, 30, 31, 33), plus a couple of consecutive-same-framing flags (shots 4, 8, 10, 44) and two non-visual words (`rhythmic`, `rustling`). The repair loop DID pass qwen the offending phrase in its avoid-list, yet qwen re-emitted it within `maxAttempts=2`. So the regenerator isn't heeding the avoid-list strongly enough.

**Scope (pick one or combine, cheapest first).**
1. Strengthen the regenerate avoid-instruction in `agents/lib/qwen.js regenerateVisualPrompt` — make the "do not reuse these phrases / do not open with this framing" constraint far more emphatic, and possibly enumerate an explicit allowed-framing list to rotate into.
2. Raise `maxAttempts` in the `repairVisualPrompts` call (currently 2) — more shots at shaking the stock phrase. Weigh the extra qwen latency on dense (40+ shot) scripts.
3. **Preferred structural fix:** add a DETERMINISTIC framing-rotation normalizer, same pattern as the existing `gap_type` adjacency normalizer in `agents/lib/manifest.js normalizeScenes` — so no two consecutive shots share a framing/shot-type BEFORE vpcheck ever runs. That removes the whole class of consecutive-same-framing flags without a stochastic regen, mirroring how gap_type repeats are already fixed in-process.

**Not blocking:** qa_flagged shots still ship to the human approval gate (they are flagged, not dropped). This is a quality/repair-rate improvement, not a correctness bug.

---

## [queued 2026-07-05] shot window sizing — 2.68s avg is tight vs the 2.5-3s target

**Problem.** The same live run produced 48 windows at **2.68s avg** over 128.6s of narration. That's below the midpoint of the intended 2.5-3s cadence range and, on longer/denser scripts, inflates shot count — which directly raises both batch stills cost (per-image) and the vpcheck distinctness pressure (more windows = more adjacency + phrase-collision constraints). The two follow-ups are related: fewer/slightly-longer windows would ease the repair-rate problem above and cut cost.

**Scope.** Revisit `agents/lib/shots.js segmentShots` window sizing. Check whether it targets the low end of the range on dense narration and whether nudging toward ~3s (or a soft cap on total shot count) meaningfully reduces shot count without hurting visual pacing. Measure against a few real scripts (short + dense) before/after.

**Not blocking:** current sizing produces valid, watchable pacing; this is a cost + repair-rate optimization.

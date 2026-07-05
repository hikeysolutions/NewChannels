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

---

## [queued 2026-07-05] poller collect — transient GET failure wrongly marked stills_failed

**Problem.** The poller's collect step treats ANY non-zero exit from the batch-status GET as terminal (stills_failed), with no distinction between "transient network/HTTP error on a still-running job" and "batch genuinely FAILED." This bit us live: row 4 flipped to stills_failed while the Gemini batch was healthily RUNNING (verified: live state still BATCH_STATE_RUNNING, no error, ~$0.82 already spent). The failing poll printed no `state=` line at all, meaning the collect subprocess crashed on the GET request itself before ever reading the state, exited non-zero, and the poller read that as a real failure.

**Scope.** Distinguish a transient GET failure (network blip, 5xx, timeout) from a real terminal batch state before marking anything stills_failed. On a transient GET error: retry with backoff and leave the row at awaiting_stills for the next poll cycle. Only mark stills_failed when the API actually reports a terminal FAILED/CANCELLED/EXPIRED state. Lives in the collect path (`agents/lib/image_providers.py` GeminiImageAdapter.poll_batch / is_failed and `agents/flyt-stills.py run_batch_collect`) plus the poller's exit-code handling in `agents/flyt-poller.js` (exit 2 = pending already exists; needs a distinct "transient, stay pending" vs "terminal fail" signal).

**Not blocking now:** scoped as a follow-up. Recovery for the current row 4 is a manual reset back to awaiting_stills so the next poll re-runs collect.

# New Channels: State of the Build (as of 2026-07-05)

This document is authoritative over `New_Channels_Master_Build_v2_7.md` wherever the two conflict. It maps every divergence in Channel A since v2.7. Also defer to `tasks/lessons.md` for hard-won corrections.

## TL;DR

The v2.7 doc describes a synchronous 10-step pipeline that generates stills plus hero video plus narration, assembles, and posts to a Telegram approval gate. Since v2.7, Channel A has been substantially re-architected and is now the primary track. Two headline changes:

1. Channel A is stills-only (no hero/Seedance video). Simple 2D stick-figure illustration style, locked.
2. Channel A is now a two-phase async pipeline, split by the Gemini Batch API for stills (50% cheaper, but not instant). Phase 1 runs synchronously and stops at a new status `awaiting_stills`. Phase 2 is a separate scheduled poller that collects the finished batch, assembles, and publishes.

Channel B still uses the original synchronous path from the doc. It has not been touched and is not the current focus.

## The as-built Channel A pipeline (replaces the doc's 10-step synchronous flow)

Key reorder vs the doc: narration now comes BEFORE stills. Stills are cut at the narration's aligned word timestamps, so the audio has to exist first. The doc generated assets in parallel then assembled; that is no longer how Channel A works.

### Phase 1 (agents/flyt-orchestrator.js, synchronous, free until the very last step)

1. Pick a combo from `entity_situation_bank` (entity plus situation, e.g. "Aztecs / before a wedding").
2. Script generation (`flyt-script-generator.js`), two stages:
   - Stage 1 prose: Groq (`openai/gpt-oss-120b`), Cerebras fallback, with the Section 06 narrator persona injected AND a gap-dynamics instruction block that makes the writer open and pay off curiosity gaps across the locked 5 beats.
   - Stage 2 scene JSON: local `qwen2.5:7b` on Ollama, then a deterministic `normalizeScenes` pass (fixes gap_type adjacency plus hero count), then strict `validateScenes`, then a vpcheck pass on the visual prompts.
3. QA gate (`agents/lib/qa.js`) is a real blocking gate that halts before any paid work. Four categories:
   - `factual_accuracy`: advisory (non-blocking, demoted).
   - `voice_consistency`: blocking.
   - `gap_logic`: blocking. Detects a stagnant curiosity chain (too many consecutive "opens").
   - `style_minor`: advisory.
   - If any blocking flag is unresolved, status goes to `qa_blocked` and the run stops. No spend.
4. Narration (`flyt-narrator.py`, VoxCPM2, CPU only, 48 kHz, voice locked via a reference clone clip). This is the slow step (roughly 10-plus minutes of local TTS).
5. Forced alignment (`flyt-align.py`, stable-ts) produces word/beat timestamps.
6. Shot segmentation (`agents/lib/shots.js`) cuts content-driven shot windows from the aligned timeline (target roughly 2.5 to 3 seconds per shot).
7. Shot-prompt pass (qwen) writes one visual prompt per shot window, with a windowed vpcheck distinctness audit that repairs or flags near-duplicate/non-visual prompts. Output is `<slug>.shots.json`.
8. Batch submit (`flyt-stills.py --batch-submit`, Gemini Batch API). This is the only paid step in Phase 1. It persists `batch_job_id` and sets status `awaiting_stills`, then exits. This is the Phase 1 finish line.

### Phase 2 (agents/flyt-poller.js, runs on a LaunchAgent every 15 minutes)

9. Collect (`flyt-stills.py --batch-collect`) checks the batch status. While it is `BATCH_STATE_RUNNING`, the poller leaves the row at `awaiting_stills` and exits. When it is SUCCEEDED, it downloads the stills and writes `<slug>.stills.json`.
10. Assemble (`assemble.py`) cuts the stills to the shot timings over the narration, producing `outputs/<slug>.mp4`.
11. Publish (`agents/lib/publish.js`): Cloudinary upload plus a bundled Telegram approval message, then status `pending_approval`.

Hard rule preserved from the doc: nothing auto-publishes to YouTube. The terminal state is `pending_approval`, waiting for a human Telegram reply.

## Where the v2.7 doc is now wrong or superseded

Treat these as authoritative over the doc:

- Channel A has no hero/video stage. `flyt-hero.py` (Seedance on Atlas Cloud) still exists and is real, but Channel A is stills-only. Hero applies to Channel B only.
- Stills for Channel A use the Gemini Batch API (async submit/collect), not a synchronous call. The doc's Section 03 step 4 ("image APIs are job-based submit/poll/complete") was actually wrong for the synchronous NB2 stills path (NB2 is synchronous), but is now effectively true again for Channel A because we deliberately chose the async Batch API for the 50% discount.
- The pipeline is two-phase. The doc's single synchronous run does not describe Channel A anymore. Phase 1 ends at `awaiting_stills`; a separate poller does the rest.
- Narration precedes stills (reordered).
- VoxCPM2 runs CPU-only and outputs 48 kHz. This box has 8 GB RAM; MPS OOMs, so CPU is the only path. An earlier assumption that `generate()` emits 16 kHz was wrong and caused a "slowed-down monster voice" bug that is now fixed. Do not re-litigate MPS.
- QA is a blocking gate, not just advisory scoring.
- New DB statuses exist beyond the doc: `awaiting_stills`, `stills_failed`, `stills_stale`, `abandoned`, plus columns `batch_job_id` and `batch_submitted_at` (migration 001).

## What is NOT built yet (the real gaps)

1. Approval-reply-handler. Nothing yet listens for the human "approve" reply in Telegram and pushes the approved video to YouTube. This is the single biggest missing piece. The pipeline currently dead-ends at `pending_approval` by design, but the human-to-YouTube bridge does not exist. (Note: `publish.js` sends the approval message and the return value carries `message_id`/`chat_id`, but neither is persisted to the DB yet, so the reply-handler will need a way to match a reply back to a row.)
2. Shorts generation. The v2.7 doc mentions multi-shorts. Not built. The Telegram caption hardcodes `shortCount: 0`.
3. Channel B name and full build. Still the legacy synchronous path.
4. Queued quality follow-ups (scoped, deliberately deferred, in `tasks/backlog.md`):
   - vpcheck's repair loop lets a repeated framing phrase ("over-the-shoulder wide establishing shot") survive across multiple shots despite being in the avoid-list.
   - Shot windows came in at 2.68s average (tight vs the 2.5 to 3s target), which inflates shot count, cost, and repair pressure on dense scripts.
   - Poller collect treats a transient status-GET failure as a terminal `stills_failed` rather than distinguishing it from a real FAILED batch state.

## Component map (files that matter)

- `agents/flyt-orchestrator.js` — Phase 1 driver.
- `agents/flyt-poller.js` — Phase 2 driver.
- `agents/flyt-script-generator.js` — two-stage script.
- `agents/lib/groq.js` — Stage 1 prose prompt (gap-dynamics block added).
- `agents/lib/qwen.js` — Stage 2 scene JSON plus shot-prompt regeneration.
- `agents/lib/qa.js` — blocking QA gate (gap_logic threshold recently recalibrated).
- `agents/lib/manifest.js` — normalize plus validate scenes.
- `agents/lib/shots.js` — shot segmentation.
- `agents/lib/vpcheck.js` — visual-prompt distinctness audit/repair.
- `agents/lib/publish.js` — Cloudinary plus Telegram (shared by both phases).
- `agents/lib/image_providers.py` — image-model provider abstraction (registry-driven adapter selection).
- `config/image-models.json` — image-model registry (model, auth, endpoints, cost).
- `agents/flyt-narrator.py`, `flyt-align.py`, `flyt-stills.py`, `assemble.py`, `validate.py`, `alert.py`.
- `launchd/com.openclaw.flyt-poller.plist` — the 15-min scheduler.
- `tasks/lessons.md` — hard-won corrections (read this before touching anything).
- `tasks/backlog.md` — the deferred follow-ups.

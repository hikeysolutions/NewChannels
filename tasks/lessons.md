# New Channels — Lessons (pipeline-wide corrections)

Format: [date] | what happened | rule to prevent repeating it

---

## VoxCPM2 local TTS — install & runtime findings (2026-07-02)

**[2026-07-02] | `voxcpm-ane` pip package does not exist | Do not run `pip install voxcpm-ane` — Section 13.2 of the v2.5 Master Build doc is wrong.**
There is no separate Apple Neural Engine backend package. Only `pip3.11 install voxcpm --break-system-packages` is real. Hardware acceleration, if any, comes through torch's MPS (Metal) backend, not a dedicated ANE package.

**[2026-07-02] | `python3.11 -m voxcpm.test --mode design ...` does not exist | Ignore the doc's test command — the `voxcpm.test` module is fictional.**
Real API: `from voxcpm import VoxCPM; m = VoxCPM.from_pretrained(hf_model_id="openbmb/VoxCPM2", device=..., load_denoiser=bool); audio = m.generate(text=...)` returns a numpy float array. Write to WAV via soundfile at 16000 Hz, mono.

**[2026-07-02] | First model load stalled at 509M on unauthenticated HF downloads | Always set `HF_HUB_ENABLE_HF_TRANSFER=1` and install `hf_transfer` before loading VoxCPM2.**
Without it, downloads stall (rate-limited, single-stream) — a foreground run got SIGTERM at 10 min stuck at 509M, twice. With `pip3.11 install hf_transfer --break-system-packages` + `HF_HUB_ENABLE_HF_TRANSFER=1`, the full weight set pulled in well under a minute. Model is now cached at `~/.cache/huggingface/hub/models--openbmb--VoxCPM2`; denoiser (zipenhancer) at `~/.cache/modelscope/iic/speech_zipenhancer_ans_multiloss_16k_base`. Re-runs should use `local_files_only=True` to skip the network entirely.

**[2026-07-02] | Smoke test PASSED but ran on CPU, not MPS — silent fallback | The doc's "runs on Apple Neural Engine, separate chip" premise does NOT hold as-is. Narration currently runs on CPU and competes with Susan et al.**
Confirmed working: valid 10.08s mono 16kHz WAV generated from text. But `from_pretrained(device="mps")` threw and fell back to CPU. On CPU, generation was ~65s for ~10s of audio (~6.5x realtime) plus a very long one-time load. Implication for the pipeline: keep the model resident/warm so the load cost is paid once per run, not per video; and treat narration as CPU-bound resource contention until MPS is proven. MPS root-cause diagnostic result: RESOLVED, see next entry.

**[2026-07-02] | MPS silent fallback root cause is OUT OF MEMORY, not incompatibility. This Mac Mini has 8 GB RAM. VoxCPM2 will NEVER run on MPS here. Use device="cpu", full stop.**
Diagnostic captured the real swallowed exception (not "MPS threw"): `RuntimeError: MPS backend out of memory (MPS allocated: 9.05 GB, max allowed: 9.07 GB). Tried to allocate 16.00 MB.` It fails inside `model.to("mps")` while streaming weights. Chain of cause: MPS has no bfloat16, so voxcpm force-upcasts bfloat16 to float32 (log line: `adjusted dtype bfloat16 -> float32 for device mps`), which roughly doubles the weight footprint to ~9 GB. The box only has 8 GB unified RAM total, so the float32 model cannot fit under the MPS high-watermark cap. Verified: MPS itself IS reachable (raw matmul works, model reaches `Running on device: mps`), so the problem is capacity, not a broken backend or broken download. The `enable_denoiser` variable is settled: on and off both failed at the identical ~9.05 GB point, so the denoiser is NOT the blocker and toggling it buys nothing. Do NOT try `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` on this machine, removing the cap just invites swap thrash / system failure on the box that runs Susan. CPU is the correct and only path: it can use virtual memory and can keep the model in bfloat16 (lower footprint). Bible Channel migration and any future VoxCPM2 session: hardcode `device="cpu"`, keep the model resident/warm (load cost is paid once, ~2-3 min; generation is ~6.5x realtime), do not re-litigate MPS.

**[2026-07-03] | CPU narrator built and proven end to end. Real timings for pipeline budgeting: load ~121s (once, kept warm), generation ~7-8x realtime warmed (~14x on the first cold scene).**
`agents/flyt-narrator.py` reads a flyt-script-generator manifest, renders one 16 kHz mono WAV per scene into `ChannelX/tmp/<slug>/scene_NN.wav`, and writes a sidecar `ChannelX/manifests/<slug>.narration.json` mapping each track to its scene timing. Verified: valid pcm_s16le 16kHz mono, non-silent (rms ~0.1). Device is hardcoded cpu, load_denoiser=False, local_files_only=True. Model runs in bfloat16 on CPU (the footprint MPS could not hold). Audio-level check (rms floor) with retry-once-then-alert is built in per Section 03 step 6. Load-once is essential: on a 2-scene clip the model load is roughly half the wall time.

**[2026-07-03] | CORRECTION (supersedes an earlier same-day entry): VoxCPM2 Voice Design IS REAL, just not where the doc said. The doc's `python3.11 -m voxcpm.test --mode design` is fiction, but the installed voxcpm 2.0.3 ships a real `design` SUBCOMMAND. The natural-language voice description goes in `--control`, not `--description`/`--mode`.**
Verified 2026-07-03: `voxcpm design --control "a calm, authoritative male narrator, ..." --text "..." --device cpu --local-files-only --no-denoiser --output out.wav` loaded on CPU and produced a valid pcm_s16le mono WAV. IMPORTANT sample-rate gotcha: the `design` CLI output was 48 kHz, whereas the Python `VoxCPM.generate()` path the narrator uses emits 16 kHz. The introspected `generate()` signature (`text, prompt_wav_path, prompt_text, reference_wav_path, cfg_value, inference_timesteps, normalize, denoise, ...`) exposes NO `--control`/voice-design param, so steering a designed voice from Python means either shelling out to the `voxcpm design` CLI or finding the method the CLI calls. The narrator still uses the default `generate()` voice at 16 kHz for now; a designed/locked channel voice is a later refinement (store any reference clips under `~/OpenClaw/NewChannels/[Channel]/`, never BibleChannel/Characters which is empty). Doc corrected to the real invocation in v2.6 (Section 13.2). **CORRECTION (see next entry): the claim that `generate()` emits 16 kHz was WRONG — it emits 48 kHz, and that mistaken assumption is exactly what caused the monster-voice bug.**

**[2026-07-03] | VoxCPM2 `generate()` outputs 48 kHz, NOT 16 kHz. Hardcoding SAMPLE_RATE=16000 in flyt-narrator.py stamped a 16 kHz header on 48 kHz audio, so every narration played at 1/3 speed and ~1.5 octaves down — the "slowed-down monster voice." Never hardcode a rate the model exposes at runtime.**
Root cause: `flyt-narrator.py` had `SAMPLE_RATE = 16000` (a "confirmed via smoke test" comment that was wrong) and wrote the WAV header with it. The loaded model exposes the truth as `model.sample_rate` (= `audio_vae.out_sample_rate` = 48000, per the model's `config.json`). Fix: read `int(getattr(model, "sample_rate", 48000))` at runtime and thread it into `render_scene`/`write_wav`/duration/sidecar. `assemble.py` was NOT at fault — it reads the source WAV's header via ffmpeg and respects it; it faithfully muxed the mislabeled audio. Verified live: the fixed narrator logs "narration sample rate: 48000 Hz" and ffprobe on a freshly rendered WAV shows `sample_rate=48000`. Before/after proof on what-did-ancient-humans-do-at-night: re-muxing with correctly-labeled 48 kHz WAVs dropped the video from 270.3s to 93.5s (exactly the 3x error). **General rule: never hardcode a device/model output parameter (sample rate, resolution, channels) the tool exposes at runtime — read it from the source and verify the real output file with ffprobe, don't trust a code constant or a remembered smoke test.**

**[2026-07-03] | Narration length does NOT match scene window automatically. A ~13-word line rendered ~10.5s. Assembly must reconcile audio duration vs. scene target duration.**
The narrator records both `audio_duration_seconds` and `target_duration_seconds` per track in the sidecar so the assembly stage can detect over/underruns. Scene durations from the qwen stage need to be narration-length-aware, or assembly needs to time-stretch stills to the audio, not the other way around. This is an assembly-session concern, flagged here so it is not missed.

**[2026-07-03] | NB2 Lite stills API is SYNCHRONOUS, not job-based. The doc's Section 03 step 4 ("image/video APIs are job-based, submit -> poll -> complete") is WRONG for stills. Only Veo video is async (predictLongRunning).**
Verified against the live Gemini endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent?key=$KEY` returns the image inline in one response (base64 in `candidates[0].content.parts[].inlineData.data`), in ~3.6s. No polling loop needed for `flyt-stills.py`. Model string `gemini-3.1-flash-lite-image` is real (confirmed via models.list). Request shape: `contents[].parts[].text` + `generationConfig.responseModalities:["IMAGE"]` + `generationConfig.imageConfig.aspectRatio`. Auth is a plain API key as `?key=` query param (NEWCHANNELS_GEMINI_API_KEY || GEMINI_API_KEY), no OAuth.

**[2026-07-03] | NB2 output is JPEG at aspect-controlled native size, NOT exact pixels. A "16:9" request returns 1376x768 (the model picks the pixels), format image/jpeg. Validate by ASPECT RATIO, not exact 1920x1080. Assembly scales up.**
`validate.check_still` gained an `expected_aspect` param (ratio check, 3% tol) for exactly this. Also fixed a latent validate.py bug the JPEG surfaced: the black-frame check used `ffmpeg -ss 0` input-seek, which returns no frame on a single-image JPEG (the image2 demuxer can't seek to 0), so every real NB2 still would have falsely failed as "corrupt". Fix: omit `-ss` when sampling at t=0 (stills); video positions are always >0, unchanged. The earlier test only used a PNG, which hid it. Lesson: test fixtures must match the real output format.

**[2026-07-03] | Hero-shot video provider is ATLAS CLOUD, not BytePlus/ModelArk (the doc is wrong). Key is ATLASCLOUD_API_KEY (in ~/.openclaw/.env, NOT exported to shell). Seedance 2.0 is a real Atlas product.**
Mistake I made and correction: I first concluded "Atlas has no video" from `GET api.atlascloud.ai/v1/models` (the OpenAI-compatible CHAT catalog). Wrong. Atlas's media generation is a SEPARATE API surface not in that list. Lesson: a provider's chat/model list is not its full product catalog; check the media-gen API + docs before declaring a capability absent. Verified working flow (async): submit `POST https://api.atlascloud.ai/api/v1/model/generateVideo` -> response prediction id at `data.id` -> poll `GET .../api/v1/model/prediction/{id}` until status `completed`/`failed`, output URL at `data.outputs[0]`. So the doc's "job-based submit/poll/complete" (Section 03 step 4) IS correct for hero video (just not for NB2 stills, which are synchronous).

**[2026-07-03] | Atlas is Cloudflare-fronted and 403s (error code 1010) any request with Python-urllib's default User-Agent. Set a real User-Agent header. curl works because its UA passes; NB2/Google does not have this problem.**
Verified: default urllib UA -> 403/1010, any custom UA (`flyt-hero/1.0`, curl) -> 200. flyt-hero.py sends `User-Agent: flyt-hero/1.0` on every Atlas request.

**[2026-07-03] | Seedance param names/values (verified against the seedance-2.0-fast t2v model page). The request key is `ratio`, NOT `aspect_ratio` (aspect_ratio is silently ignored). Fast-tier `resolution` valid values: 480p, 720p, 720p-SR, 1080p-SR, 1440p-SR (NO plain 1080p). duration 4-15s or -1 auto. model id `bytedance/seedance-2.0/text-to-video` (fast: `bytedance/seedance-2.0-fast/text-to-video`).**
Live-proven with fast tier: 720p + ratio 16:9 -> 1280x720 h264 mp4, 5.04s for a requested 5s, generated + downloaded in ~109s. Standard-tier valid resolutions NOT yet verified (verify before first standard-tier run; the pipeline default is standard).

**[2026-07-03] | COST-SAFETY: a bug in the validator must never trigger a paid re-generation. `run_with_retry` now retries ONLY on produce() exceptions or a not-ok Report; if validate() itself raises (a code bug), it propagates immediately without re-running produce().**
Learned the hard way: check_video was missing the `expected_aspect` kwarg I'd only added to check_still, so validate() raised TypeError, which the old run_with_retry treated as a failed attempt and RETRIED, spending a 2nd Seedance clip on a code bug. Fixed + tested. When adding a kwarg to one check_* function, add it to the sibling (still/video) too.

**[2026-07-02] | Chatterbox removed portfolio-wide, replaced by VoxCPM2 | `chatterbox-tts` uninstalled globally. Susan/James/board-agent only referenced it via CPU-monitor/keyword strings (safe). BibleChannel `tts-chatterbox.py` + `voice-agent.js` primary path now broken (falls back to Google TTS) — needs its own migration session to VoxCPM2.**

---

---

## Reference-image conditioning for NB2 Lite stills — feasibility (2026-07-04)

**[2026-07-04] | NB2 Lite (`gemini-3.1-flash-lite-image`) supports image-conditioned generation, not just text. FOLLOW-UP to consider ONLY if the text-only `CHANNEL_STYLE` prompt doesn't hold character/style consistency well enough after the upcoming combined test.**
Verified against Google's current image-generation docs: `gemini-3.1-flash-lite-image` accepts up to 14 input images total alongside the text prompt, and "character consistency images" + "style references" are first-class, documented use cases. This is the API's intended mechanism for exactly the era-drift / character-consistency problem already hit once with text-only prompts. Implementation, if built, is an ADDITIVE change to `flyt-stills.py`'s `generate_still()` request body: append image parts as `inline_data` ({mime_type, base64}) to `contents[0].parts[]` next to the existing `{text: prompt}` part (mirrors the response side, which already reads `inlineData.data`). A natural anchor store is a per-channel reference file (e.g. `ChannelA/style/`). Not built yet, by decision — text-only `CHANNEL_STYLE` is tried first. Caveats to weigh before building: (1) reference images likely raise per-image cost/latency (more input tokens per call), verify the delta before using at volume; (2) **the anchor image MUST be a self-generated / self-approved image (e.g. a first approved generation promoted to anchor), NEVER a saved screenshot of Zenn's actual artwork — IP concern.**

---

## VoxCPM2 narrator voice DRIFTS across scenes unless you clone a reference — clone lock proven (2026-07-04)

**[2026-07-04] | A bare `model.generate(text=...)` re-randomizes the speaker on every call, so the narrator identity swings scene to scene (male one scene, near-female the next). LOCK it by cloning a fixed per-channel reference clip: pass `prompt_wav_path` + `prompt_text` on every generate. Proven with an A/B measurement, not by ear.**
Root cause: VoxCPM2's default generate path samples the voice stochastically and unseeded, so each scene gets a fresh speaker. The fix is voice cloning: generate one reference clip once (design mode), save it as the channel's fixed narrator, and pass it as `prompt_wav_path` (+ its transcript as `prompt_text`) into `generate()` for every scene. That conditions all output on the same voice.

A/B PROOF (objective, `tasks/`-style F0 + spectral-centroid measurement, not listening). Reference clip `ChannelA/voice/narrator_a.wav` = F0 115.7 Hz.
- BEFORE (bare default, 11 real scenes of "what-did-ancient-humans-do-at-night"): F0 mean 156.4 Hz, **STD 34.7 Hz, range 112-217** (scene_01 hit 217 Hz — a different, higher voice); centroid STD 853 Hz.
- AFTER (clone lock, 4 clips each with DIFFERENT text so it can't be memorization): F0 mean 115.2 Hz, **STD 2.4 Hz, range 112-119** — every clip pinned to the reference's ~116 Hz; centroid STD dropped 853 -> 309 Hz.
Cross-scene F0 scatter collapsed ~14x (34.7 -> 2.4 Hz). Different input text, same measured voice. That is the decisive proof the clone lock works.

IMPLEMENTATION (already in `agents/flyt-narrator.py`): `main()` requires `ChannelX/voice/narrator_a.wav` + `narrator_a.txt` and hard-fails with a clear message if either is missing (no silent drift). `render_scene(...)` now takes `prompt_wav_path` + `prompt_text` and threads them into `generate()`. `load_denoiser=False` stays correct here BECAUSE the reference is a clean self-generated clip — the denoiser only helps NOISY reference input, so it is still dead weight. Regenerate a lost reference with a VoxCPM2 design-mode call (see the `gen_reference` approach), never hardcode a voice you can't reproduce.
General rule: for any generative model with stochastic identity (voice, character, style), prove consistency with an objective cross-sample metric, not by ear/eye, and lock identity by conditioning on a saved reference — never trust the default sampler to stay put.

---

## Phase 2 poller — testing & LaunchAgent gotchas (2026-07-05)

**[2026-07-05] | `cp tracking.db copy.db` produced a copy with NO videos table (SqliteError: no such table: videos) because the DB is in WAL mode and the table lived in the uncopied -wal file | Never plain-`cp` a live SQLite DB in WAL mode. Use `sqlite3 src ".backup '/abs/dest.db'"` for a consistent standalone copy.**
The tracking DB runs `journal_mode=WAL` (set in `agents/lib/db.js openDb`). Recent writes sit in `tracking.db-wal` until a checkpoint, so copying only the main file loses them. `sqlite3 .backup` (or copying .db + -wal + -shm together, or checkpointing first) captures the full state. This bit the flyt-poller stub test: the seeded row landed in a copy that openDb then couldn't read. Related but separate footgun that hit the same test: `node -e '...' CP="$CP"` passes `CP=...` as a positional argv, NOT an env var — use the `CP="$CP" node -e '...'` prefix form so `process.env.CP` is actually set.

**[2026-07-05] | flyt-poller LaunchAgent failed under launchd (worked in-shell) with `NODE_MODULE_VERSION 127 vs 141` — native better-sqlite3 ABI mismatch | A LaunchAgent running a node script with native modules MUST use the exact node the modules were compiled against. This repo's better-sqlite3 is built for nvm node v22.22.0 (ABI 127); do NOT point the plist at /opt/homebrew/bin/node (newer ABI).**
My Bash and the user's terminal both default to `/Users/clawbot/.nvm/versions/node/v22.22.0/bin/node`, so the poller ran fine interactively. The plist initially copied the `com.openclaw.followup-sequencer` pattern which uses Homebrew node — fine for a pure-JS script, fatal for one loading a native .node built against a different ABI. Fix: `ProgramArguments[0]` = the nvm node absolute path. General rule: for any launchd/cron job invoking node with native deps, hardcode the compiling node's path, and always force one `launchctl start` + read the .err.log to confirm it runs under the agent, not just in your shell (RunAtLoad=false means a silent ABI failure would otherwise go unseen until the first interval fire).

---

## Gemini Batch API state enum — BATCH_STATE_*, not JOB_STATE_* (2026-07-05)

**[2026-07-05] | The Gemini Batch API returns `metadata.state = "BATCH_STATE_SUCCEEDED"`, but `config/image-models.json` declared `batch.done = "JOB_STATE_SUCCEEDED"` (the Vertex AI job enum). `is_done()` compared them and was ALWAYS False, so a fully-completed batch with all 48 images present read as `[pending] not ready yet` forever and never collected. Row 4 sat at `awaiting_stills` indefinitely. | Never assume a Google model API reuses the Vertex `JOB_STATE_*` enum. The generativelanguage (Gemini) Batch API uses its own `BATCH_STATE_{PENDING,RUNNING,SUCCEEDED,FAILED,CANCELLED,EXPIRED}` prefix. Confirm the real state string from a live response before wiring any done/failed comparison.**
Diagnosed read-only against the real completed job `batches/oa52i75...`: raw `metadata.state` was `BATCH_STATE_SUCCEEDED`, the `response.inlinedResponses` payload held all 48 images, and `collect_images(op)` extracted 48/48 — the ONLY thing broken was the state-string comparison. Twin latent bug: `is_failed()` used the same `JOB_STATE_*` strings, so a genuinely FAILED batch would also have hung at "not ready" instead of erroring. Fix (`9c38d2f`): registry `batch.done` -> `BATCH_STATE_SUCCEEDED`, `batch.failed` -> `BATCH_STATE_{FAILED,CANCELLED,EXPIRED}`. Direct proof exists only for `SUCCEEDED`; the three failed strings are set by prefix-consistency with the documented Gemini Batch enum. General rule: state/status enums are API-surface-specific even within one vendor (Vertex vs generativelanguage), and a wrong enum string fails SILENTLY as a permanent "not ready" rather than an error — always verify the literal string from a real response, and if another Gemini/Vertex endpoint gets wired in later, re-check its enum rather than copying this one.

---

## Data-visual build — prompt-size and small-model findings (2026-07-05)

**[2026-07-05] | Adding prompt blocks to groq.js silently killed the Groq primary: input grew past the 8000 TPM cap (input + max_tokens reservation = 8197), every call 413'd, and the pipeline fell back to Cerebras on EVERY run with only a [warn] line to show for it. | After ANY edit that grows the Stage-1 system prompt (including ChannelA/STYLE_GUIDE.md, which is embedded in it), re-check that input + max_tokens stays under 8000, and watch the first live run for the 413 [warn]. A 413 here fails SOFT, so it will not error — it just quietly moves 100% of traffic to the fallback.**
Fixed by dropping the reservation 5500 -> 4800 (input is now ~2700). The style guide is part of the prompt: growing the doc grows the request.
Groq max_tokens reservation lowered to 4500 (from 4800) to maintain ~500 token headroom after Kallaway prompt additions — re-check this budget after any future edit that grows the Stage 1 system prompt, same as the original 413 lesson.

**[2026-07-05] | qwen2.5:7b ignored a detailed prose rule ("use subject_type data_visual when...") across 4 straight runs — zero tagged scenes — but tagged correctly the moment the JSON shape EXAMPLE contained a data_visual scene. | For qwen2.5:7b (and small instruct models generally), a new output category must appear in the few-shot/JSON-shape example, not just in the rules text. Examples beat prose.**
Side effect to accept: qwen imitates the example's visual_prompt wording at the scene level. Harmless for data_visual (the per-shot generateDataVisualPrompt pass writes the real graphic prompt), but keep example wording generic.

---

## data_visual under-tagging — log only, do not fix yet (2026-07-05)

data_visual under-tagging: qwen currently tags 1-2 data_visual scenes even when Stage 1 writes 3 anchors. Not a bug yet, real usage will show if this matters. Revisit trigger: if 3 of the next 5 real (non-test) videos come back under-tagged relative to anchors written, that's the signal to strengthen the qwen prompt/example (same "pattern needs 3+ occurrences" logic as the Boris dream.js worker). Until then, log only, don't gate, don't fix. The advisory check lives in qa.js dataVisualPacingFlags check (d), category data_visual_pacing, never blocking.

---

## Assembly, providers, batch/sync routing, and the qa gate (2026-07-05)

**[2026-07-05] | Assembly: FFmpeg confirmed correct for the current stills+timestamps use case (verified via research comparison). Revisit Remotion specifically when the caption/era-tag overlay system (deferred Section 08 TEMPLATE.md wiring) gets built — that's the point where dynamic per-scene text overlays make FFmpeg meaningfully harder to maintain than Remotion. Not before.**

**[2026-07-05] | Model provider registries (LLM: Groq/Cerebras; Image: Gemini/Atlas) are config-driven, not hardcoded per-agent — same --channel parameterization discipline as script/style/title logic. Confirmed via real fallback test: flipping Channel A's image_model config back to Gemini after Atlas work was added required zero code changes and worked identically to before. Any future provider swap (new LLM, image model discontinued, pricing change) should be a config edit only.**

**[2026-07-05] | Atlas Cloud does not expose a true bulk-submit batch endpoint for GPT Image 2 despite marketing language — confirmed against actual public API docs (only single generateImage + prediction/{id} polling exists). Real batch-level throughput requires a concurrency-capped async worker pool built on our end, not a native Atlas batch job. This is what the sync-routing path implements.**

**[2026-07-05] | Sync-routing (non-batch providers): with a sync provider, paid generation runs inside the poller's collect step. At production shot-counts (~160-190 for an 8-min video), sequential generation would take 10+ minutes and risks the LaunchAgent poller interval overlapping itself. Concurrency-capped worker pool required — this was corrected after an initial sequential implementation surfaced the issue in real testing.**

**[2026-07-05] | test_qa_gate.js's "gate returns >=1 blocker" failure was flagged as pre-existing across at least 3 separate sessions before actually being investigated and fixed (commit e347ac0, "qa gate test now proves blocking with a bad fixture"). Lesson: don't let a flagged-but-deferred test failure on the hard-stop QA gate ride along indefinitely — it directly affects whether a bad video actually gets blocked in production.**

---

## Stage 2 (scene JSON) moved to the LLM registry — cut-point coverage (2026-07-05)

**[2026-07-05] | Whole-script -> scene JSON moved off local qwen2.5:7b onto the registry (Groq primary, Cerebras fallback). Root cause of the move: a full 4-5 min script overflows the 7B model's 4096 context, truncating the JSON and flattening the gap_state chain to all "opens" (verified: 586-word script -> 243/586 words captured, 15x "opens", dur 64s vs the ~234s it should be). Commit 1b34d8a.**
The num_ctx:8192 patch was superseded by this and reverted.

**[2026-07-05] | gpt-oss-120b is a REASONING model. In json_object mode on the scene-JSON prompt at DEFAULT reasoning effort it spends the ENTIRE max_tokens budget on hidden reasoning and emits ZERO content (measured: 5997 reasoning tokens, finish_reason "length", empty JSON -> Groq 413, Cerebras empty). Fix: set `reasoning_effort: "low"`. | For any gpt-oss (or reasoning-model) structured-JSON call, set reasoning_effort low, or the model reasons past the token budget and returns nothing. "medium" is unusable here: Cerebras low still burns ~3566 reasoning tokens, medium ~7497 (blows even a 7500 reservation). Stage-1 prose gen does NOT need this — only the JSON path did.**

**[2026-07-05] | Asking ANY model to re-emit narration verbatim while segmenting made it ABRIDGE — it dropped ~half the script's sentences (14/31 preserved). Both qwen AND gpt-oss did this. | Never have the LLM reproduce source text it must preserve. Redesign: split the script into numbered sentences LOSSLESSLY (script_segments.js: splitSentences(t).join("")===t), have the model assign each scene a contiguous SENTENCE RANGE only, and reconstruct narration by slicing + compute timing from word count. 100% verbatim coverage by construction. validateScenes now HARD-FAILS on any narration!=script mismatch (permanent net) so a drop can never ship silently again.**

**[2026-07-05] | Stage 1 (script ~7500 tok) + Stage 2 (scene JSON ~5300 tok) now both hit Groq back-to-back within seconds = ~12800 tokens in one minute, over the 8000 TPM per-minute limit, so Stage 2 usually 429s on Groq and lands on Cerebras. This is SOFT (falls through, Cerebras verified-clean) so it is not a failure, but "Groq primary for scene JSON" is mostly theoretical in a single back-to-back run. | Distinct from the single-request 413 ceiling: this is the per-minute 429 the earlier lesson predicted. If Groq-primary for Stage 2 ever actually matters (cost/latency), either space the two calls ~60s apart or give Stage 2 its own Cerebras-first provider order. Single-request budget itself is fine: scene-JSON Groq call is ~5319 total (input 2672 + 4500 reservation = 7172, ~828 headroom under 8000).**

---

## Memory pressure, VPS survey, and no-real-person in narration (2026-07-06)

**[2026-07-06] | Memory-pressure recovery: freeing RAM mid-run (closing non-essential apps / stale sessions) let a degraded CPU-bound process (VoxCPM) recover to baseline speed in ~2 minutes without restarting. | A stuck/slow long-running local process doesn't always need a restart — check memory pressure first and free RAM before killing and re-running.**

**[2026-07-06] | VPS survey: Ollama is running and network-reachable on the VPS, but only `qwen2.5-coder:3b` is pulled (no instruct-class 7B model), and VoxCPM is not installed at all. Real estimate for running both concurrently: ~9-10GB needed vs 12GB available — too tight. | Must stagger/queue on the VPS (qwen JSON generation, unload, then VoxCPM), not run simultaneously. Ollama's `:cloud` tags are NOT a substitute (LLM-only, no TTS) — a real VPS migration is still needed for narration.**

**[2026-07-06] | Arc Bureau content ideas must never use real, identifiable named individuals (public figures, historical figures, especially any true-crime / convicted-criminal figures). | The no-real-person rule applies to narrative/narration content too, not just visuals/images. Use fictional/archetypal framing instead (e.g. "a gunslinger," not a named real outlaw).**

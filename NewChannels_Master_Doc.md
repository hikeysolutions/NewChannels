# NewChannels Master Doc
**Status: CANONICAL. Single source of truth for the New Channels build.**
**Supersedes and replaces `New_Channels_Master_Build_v2_7.md` and `docs/STATE-SINCE-v2.7.md` (both archived).**
Last verified against repo state: 2026-07-05 (git HEAD `b87d504`).

---

## HOW TO USE THIS DOCUMENT

This is the unified spec. Per this project's standing rule, specs are single files, never addenda. Where this doc and the code ever disagree, the code and DB win, and this doc gets corrected, never the other way around.

Every claim about pipeline state below was checked directly against code, git log, the tracking DB schema, `tasks/lessons.md`, and `tasks/backlog.md` before being written. Two classes of claim are marked explicitly:
- **[reported, not repo-verifiable]**: a result from a one-time analysis this build ran (for example a pitch-scatter measurement) that left no artifact in the tree. Recorded because it drove a real decision, but it cannot be re-confirmed from the repo alone.
- **[open item]**: a decision or task that is not built yet. Collected in Part 5.

---

## PART 1 — CHANNEL A ("Before Now") — AS-BUILT PIPELINE

Channel A has moved from the original synchronous 10-step pipeline to a two-phase async architecture. It is the primary track and the only channel with real, tested infrastructure. Channel B still points at the legacy synchronous path and has not been touched.

Key reorder from the original doc: narration now comes BEFORE stills. Stills are cut at the narration's aligned word timestamps, so the audio has to exist first.

### Phase 1 (`agents/flyt-orchestrator.js`, synchronous, free until the last step)

1. Pick a combo from `entity_situation_bank` (entity plus situation, for example "Aztecs / before a wedding").
2. Script generation (`flyt-script-generator.js`), two stages:
   - Stage 1 prose: Groq (`openai/gpt-oss-120b`), Cerebras fallback (`gpt-oss-120b`), in `lib/groq.js`. The system prompt carries three stacked blocks: the Section 06 narrator persona, the gap-dynamics arc, and the Story Ladder craft rules (Part 2).
   - Stage 2 scene JSON: local `qwen2.5:7b` on Ollama (`lib/qwen.js`), then deterministic `normalizeScenes` (fixes gap_type adjacency and hero count), then strict `validateScenes`, then a `vpcheck` pass on the visual prompts.
3. QA gate (`agents/lib/qa.js`), a real blocking gate that halts before any paid work. Four categories:
   - `factual_accuracy`: advisory, non-blocking (demoted). Flags still logged to `qa_flags` for weekly human review.
   - `voice_consistency`: blocking. Section 06 five-question rubric, scored out of 10, rejects at score <= 5.
   - `gap_logic`: blocking. Deterministic stagnation detection over the gap_state chain. Threshold `OPENS_RUN_THRESHOLD = 7` (a maximal run of 7+ consecutive "opens" reads as a stagnant chain; calibrated so the legitimate ~6-scene "explainer belly" of the curiosity format is admitted).
   - `style_minor`: advisory, non-blocking (em/en dash check).
   - If any blocking flag is unresolved, status goes to `qa_blocked` and the run stops. No spend.
4. Narration (`flyt-narrator.py`, VoxCPM2, CPU-only, 48 kHz, voice locked via a reference-clone clip at `ChannelA/voice/narrator_a.wav` + `.txt`). This is the slow step, roughly 10-plus minutes of local TTS. This box has 8 GB RAM; MPS OOMs, so CPU is the only path. Do not re-litigate MPS.
5. Forced alignment (`flyt-align.py`, stable-ts) produces word and beat timestamps from the real generated audio.
6. Shot segmentation (`agents/lib/shots.js`) cuts content-driven shot windows from the aligned timeline. Target roughly 2.5 to 3 seconds per shot, driven by alignment and clause boundaries, not a fixed timer.
7. Shot-prompt pass (qwen) writes one visual prompt per shot window, with a windowed `vpcheck` distinctness audit that repairs or flags near-duplicate and non-visual prompts (for example "crackling", "whispering"). Output is `<slug>.shots.json`. Never silently ships a bad scene; falls back to a `qa_flag`.
8. Batch submit (`flyt-stills.py --batch-submit`). The only paid step in Phase 1. Persists `batch_job_id`, sets status `awaiting_stills`, exits. This is the Phase 1 finish line.

### Phase 2 (`agents/flyt-poller.js`, LaunchAgent, every 15 minutes)

9. Collect (`flyt-stills.py --batch-collect`) checks batch status. While the batch is still running, the poller leaves the row at `awaiting_stills` and exits. When SUCCEEDED, it downloads the stills and writes `<slug>.stills.json`.
10. Assemble (`assemble.py`, plain ffmpeg) cuts the stills to shot timings over the narration, producing `outputs/<slug>.mp4`. HyperFrames vs Remotion evaluation (Section 09) remains deliberately deferred; ffmpeg is the current path.
11. Publish (`agents/lib/publish.js`): Cloudinary upload plus a bundled Telegram approval message via FlytBot, then status `pending_approval`. The message id and chat id are persisted to the row (`tg_message_id`, `tg_chat_id`, migration 002).

Hard rule preserved from the original doc: nothing auto-publishes to YouTube. The terminal state of the generation pipeline is `pending_approval`, waiting for a human Telegram reply.

### Phase 3 (`agents/flyt-approvals.js`, separate LaunchAgent, every 5 minutes)

The human-approval reply handler. Long-polls FlytBot `getUpdates` (polling, not webhook), matches each reply to its row via `reply_to_message.message_id` scoped to `tg_chat_id`, and records the decision. On approve, a decoupled upload pass drives every `approved` row to YouTube and on to `published`. Full mechanic in the Approval Handler section below.

### Cost model (verified against registry and backlog)

- Active image model for Channel A is `gemini-nb2-batch` (`ChannelA/config.json`), the Gemini Batch API at **$0.017/image** (50% off the synchronous rate; async, not instant). This is the real, live pricing in `config/image-models.json`.
- First live Channel A batch run (Aztecs / before a wedding, 48 shots) cost **$0.816** (48 x $0.017). This equals the registry rate times shot count; treat it as the batch-rate cost for a run of that size.
- Original v2.7 estimate was $0.30 to $0.80/video on the old stills-plus-hero synchronous model. The interim post-pacing-fix estimate of roughly $5 to $8/video at standard (non-batch) pricing is **[reported, not repo-verifiable]**; it drove the move to the Batch API and is recorded for that reason.
- GPT Image 2 migration is **NOT complete**. Gemini remains the active model. See the GPT Image 2 status note below.

### GPT Image 2 status (important, do not overstate)

The image-model abstraction layer is real and committed (`config/image-models.json` registry, `lib/models.js` JS resolver, `lib/image_providers.py` Python adapters, wired into `flyt-stills.py`). It is not design-phase.

The registry currently holds a GPT Image 2 entry (`gpt-image-2`) built against **OpenAI's direct images API** at **$0.04/image**, marked "STUB, not wired" (`OpenAIImagesAdapter.generate_still` raises `NotImplementedError`). That is a real and valid route, but it is NOT the route that was live-tested this session.

The live-tested "flawless consistency across sequential prompts" result went through **Atlas Cloud's GPT Image 2 endpoint** specifically (model string `openai/gpt-image-2/text-to-image`), which Atlas Cloud prices at roughly **$0.008 to $0.009/image** [reported, not repo-verifiable] on its own pricing page. That is a different provider and route to the same underlying model, with meaningfully cheaper economics. It is NOT wired into the pipeline. Do not present the Atlas Cloud pricing as something already in the pipeline. Wiring the Atlas Cloud route is a tracked follow-up in Part 5.

### Key fixes applied (each verified committed)

- Persona injection (`4858d71`): Section 06's "Reluctant Witness" persona was specified but never wired into the generation prompt. Now injected into the Groq system prompt in `lib/groq.js`. Reported improvement: voice-consistency 2/10 to 8/10 on the same test combo [reported, not repo-verifiable as a metric].
- Sample-rate fix (`51c6228`): VoxCPM2 output was written at a hardcoded 16 kHz when actual output is 48 kHz, causing a slowed-down distortion. Now reads the model's real rate at runtime.
- Voice lock (`c25fbbd`): narrator had no fixed voice. Locked via reference-clip cloning (`ChannelA/voice/narrator_a.wav` + `.txt`). Pitch-scatter collapsed from roughly 35 Hz STD to roughly 2.4 Hz STD, pinned near the reference's ~116 Hz [reported, not repo-verifiable].
- Visual style (`a6b3a77`): style is simple 2D stick-figure / vector illustration, NOT photorealistic. Corrected in `ChannelA/STYLE_GUIDE.md` and encoded as `CHANNEL_STYLE["channel_a"]` in `flyt-stills.py`.
- Era/subject drift (`a6b3a77`): a structured `render` block per scene (era, location, subject_type, style) with controlled-vocabulary validation (fail-fast, same pattern as `gap_type`).
- Pacing: cuts moved from 10 to 12 seconds down to content-driven 2.5 to 3 second windows via forced alignment.
- Hero removal (`bb6015a`): Channel A is stills-only, no Seedance video clips. `flyt-hero.py` (Seedance 2.0 on Atlas Cloud) still exists and is real, but applies to Channel B only.
- Gap-chain stagnation (`95a7c04`, `213c9fb`): the generator was producing all-opens-then-resolves chains, correctly tripping `gap_logic`. Fixed with explicit prose-arc guidance (early partial_resolve) and threshold recalibration to 7.
- Deterministic visual-prompt repair (`9339900`): `vpcheck.js` detects and regenerates near-duplicate or non-visual prompts, falling back to a QA flag rather than silently shipping.

---

## PART 2 — NARRATIVE CRAFT RULES

Three stacked blocks in the `lib/groq.js` Stage-1 system prompt govern the writing. They layer, they do not replace each other.

### Persona (Section 06) — "The Reluctant Witness"
Voice identity. The frozen persona text is the machine-readable copy in `agents/lib/personas.js` (identity stays implicit, never stated). Governs word choice, framing, worldview. High permitted ambiguity.

### Gap dynamics
Governs WHEN tension opens and closes across the locked 5-beat format: open the core question at the hook, settle a small sub-question during setup, land a real partial payoff in the middle, deliver the surprising specific at the reveal, close the core question at the emotional payoff.

### Story Ladder (built this session, `b87d504`)
Governs HOW each beat is built. Four rules, layered on top of persona and gap dynamics, never labeled in output:
1. **Genuine misdirection, not just new facts.** At least one beat names a belief the viewer already holds, then flatly inverts it ("you assume X; you're wrong, it's actually Y"). A genuine rug-pull, stronger than merely contradicting an earlier line.
2. **Nested loops per topic.** Each fact-cluster closes its own loop before the next opens: claim (WHAT), reason or mechanism (WHY), concrete case (EXAMPLE), meaning (TAKEAWAY). No jumping to a new topic half-explained, even as the larger gap chain keeps building.
3. **Early personal stakes.** In the first two beats, make it land that this is about the viewer's own body, behavior, or life now, not an abstract fact about the entity.
4. **No tactical closer.** The final beat must not resolve into advice or a tidy wrap-up. End on an open, resonant, slightly haunting image (consistent with the persona's high permitted ambiguity).

Note on a live tension: Rule 4 (end open) sits alongside the gap-dynamics instruction to "close the core question with a real resolution." Both hold in the prompt. In practice they coexist: the script answers the curiosity question but lands on a resonant open image rather than advice. Verified in text-only regen, all four rules surface in output.

Verification standard for future edits to these rules: regenerate a fixed test combo 3 to 5 times, text-only (no narration, no stills, no spend), re-score against the Voice Consistency rubric, and qualitatively confirm each rule shows up. Commit as its own isolated change. Source material (the Kallaway Story Ladder breakdown and the annotated Zenn transcript) belongs in `docs/references/` for human tuning, NOT injected into the live prompt.

---

## PART 3 — CHANNEL ROADMAP

Five channels total. External research this session put realistic operator bandwidth at 2 to 3 actively-managed channels, so this is a backlog, not a parallel build plan.

- **Channel A — "Before Now"** (BUILT, active refinement). Historical curiosity format, locked. The only channel with real, tested infrastructure. See Part 1.
- **Channel B — Countdown/Listicle** (PLANNED, not built; name TBD, "Ten Deep" rejected). Shares Channel A's agent codebase via `--channel`. Flagged risk: YouTube's 2025 "Inauthentic Content" enforcement wave specifically targets templated, noun-swapping listicle formats. Do not build without addressing that risk first (Part 5).
- **Channel C — "FailNation"** (PLANNED, next in queue after Channel A stabilizes). 30 to 60 second comedic "fail" shorts. Content scope locked: young adults and animals only, no minors. Always resolves safely, slapstick not real harm. Original AI characters only. Storyboard stills confirmed working on GPT Image 2. Video model not finalized (Pixverse C1 standard researched as compliant; since content is adults-only, cheaper uncensored tiers also become viable and should be re-compared before committing, subject to Part 4).
- **Channel D — "Fun History"-style long-form** (PLANNED, concept-stage). 12 to 20 minute compressed historical timelines. Single narrator voice. Three-layer visual style (historical photography base, vector map/text overlays, flat 2D cartoon reaction overlays). Needs its own name; the working title collides with an existing real channel, do not use it. No build work started.
- **Channel E — "Fish Outta Water"** (PLANNED, lowest priority). 30 to 60 second shorts, wholly original character(s) in high-stakes premium-aesthetic scenarios. Cinematic luxury identity (metallic gold/platinum, high contrast). Sequenced last on purpose: it requires character design first, then visual style, then everything else. Hardest unsolved problem of the five is building genuine parasocial attachment to a brand-new character (case studies: Lil Miquela, Neuro-sama).

---

## PART 4 — CONTENT POLICY / COMPLIANCE — LOCKED

Hard, non-negotiable constraint on all current and future channels. Not a per-project judgment call. It is here so it stops being re-litigated.

### Real people — prohibited, no exceptions
Do not generate synthetic video or image content depicting real, identifiable people (living or deceased) without explicit, specific, written consent covering AI/synthetic-likeness use. A general "they'd probably be fine with it" or an existing informal relationship is NOT sufficient consent for this use case.

Legal basis, not just platform ToS: the ELVIS Act (Tennessee, explicitly extraterritorial, applies regardless of where the creator or depicted person resides) and the federal NO FAKES Act (advancing through the Senate as of this session) both create enforceable rights over a person's voice and likeness, with liability extending to developers or distributors of technology whose primary function is the unauthorized production of an individual's likeness. Building a system to do this repeatedly is its own distinct exposure, separate from any single video.

### Copyrighted characters — prohibited, including "suggestive" or altered versions
Do not generate characters recognizably derived from existing copyrighted IP, even with altered details. Enforcement standards are based on substantial similarity and recognizability, not exact-match identity. A deliberately-recognizable "similar but not identical" version does not avoid infringement; intentional recognizability is evidence the resemblance is not coincidental.

### Depicting minors — resolved by avoidance
For any content with people in physical or comedic scenarios (for example FailNation): default to young adults only, no children or teens. Primary-source ToS review (Pixverse, Seedance, Vidu) found a defensible reading that safe depictions of minors are technically permitted on standard tiers, but automated moderation is imperfect and more likely to flag content involving children regardless of the correct reading, and there is no upside to carrying that ambiguity when the format works equally well with adults. Locked decision: avoid entirely, do not rely on the permissive reading.

Zero-ambiguity hard rule: Spicy/uncensored model tiers require an explicit 18+-only confirmation on every API call (verified from Atlas Cloud's own model documentation). Never use these tiers for any content that could depict a minor, full stop.

### "Uncensored tier as a workaround" — not a valid strategy
Routing ambiguous or restricted content through an uncensored API tier to bypass a standard tier's restriction does not reduce legal or platform risk. It only shifts where enforcement happens (upload-time platform detection instead of generation-time API refusal). Resolve content-policy risk by not generating the content, not by finding a provider willing to generate it.

---

## PART 5 — OPEN ITEMS / KNOWN GAPS

- **GPT Image 2 via Atlas Cloud (follow-up code task, not started).** Add a new adapter entry to `config/image-models.json` for GPT Image 2 via Atlas Cloud, and wire it as a real, tested option alongside `gemini-nb2-batch` and the existing OpenAI-direct stub. There are three distinct routes to the same underlying model; do not confuse them:
  - OpenAI-direct (`gpt-image-2`, $0.04/image): the stub currently in the registry. Different API shape, not wired.
  - Atlas Cloud standard endpoint (`openai/gpt-image-2/text-to-image`, roughly $0.008 to $0.009/image): the route live-tested this session for stick-figure and photoreal consistency.
  - Atlas Cloud Developer endpoint (`openai/gpt-image-2-developer/text-to-image`): a different and cheaper route, with quality-tiered pricing from actual billed usage:
    - low quality: ~$0.0045/image
    - medium quality: ~$0.0206/image
    - high quality: ~$0.07/image
  The Developer endpoint uses Atlas Cloud's generateImage then poll pattern (`POST /api/v1/model/generateImage`, then `GET /api/v1/model/prediction/{id}`), a different request/response shape than the OpenAI-direct stub, so it needs its own adapter when this is picked up.
  Quality tier must be chosen per channel, not assumed uniform. At ~$0.0045/run on the low tier, a 48-shot Channel A video is roughly $0.22 vs Gemini's current $0.816.
  Test results on the "low" tier (three real two-prompt pairs through the actual Atlas Cloud Developer endpoint, not a wrapped tool; confirmed cost $0.00451/run):
  - Character face, build, and hair, and garment TYPE, held perfectly across all three test pairs, through dramatic pose, action, lighting, and emotional shifts, including photorealistic content. Identity and silhouette, the things that actually matter for audience recognition across a short, are reliable at low quality.
  - The real weak point is exact color/shade matching, not environment per se. Minor shade or color details on any single element can drift unpredictably: a couch color drifted in one test, a jacket color in another, while the environment held flawlessly in the third. The earlier "environment is the weak point" framing was too narrow. The actual pattern is per-element color drift, wardrobe or environment alike.
  - Reframed finding: low quality is reliable for identity, build, and garment type. Do not rely on it for exact color-matching of any single detail (wardrobe or environment) if a specific shot depends on that exact color staying identical across shots.
  Practical implication for FailNation (photorealistic): character identity, build, and garment type are reliable at low quality, so low is a reasonably strong default for FailNation too, not just Channel A. But exact color continuity should NOT be relied on for any gag or detail that depends on a specific color staying identical across shots. If a shot needs an exact recurring color, either accept the drift risk, generate that shot with maximal color specificity, or check a higher quality tier before shipping that particular shot.
  Working assumption: "low" is a reasonably strong default for BOTH Channel A (stick-figure, low-risk regardless) and FailNation. Three tests show it is already strong on the things that matter (identity, build, garment type); color-matching is the one caveat.
- **Tier 2 consistency architecture (future option, NOT YET NEEDED, do not build).** A fallback design for IF exact color/detail drift becomes a real, visible problem once shipping real content. Three tests show low quality alone is already strong on the things that matter (identity, build, garment type), so this is deliberately not built. Build it only if shipped content surfaces color/detail drift as an actual on-screen problem, not preemptively. The design:
  - Generate one HIGH quality "reference" image per character or key scene (ground-truth visual identity, ~$0.07/image, once per character/scene rather than per shot).
  - Pass that reference image to a vision-capable model (for example the Qwen3-VL:2b already scoped for post-generation QA on Channel A, or a similar small vision model) to extract a precise, reusable text description of the fixed visual details (exact colors, exact garment details). This is an automated version of a manual "character registry" file.
  - Feed that extracted description into the LOW quality per-shot generation prompts for the bulk of the video's stills, so the low-cost generations inherit a more precisely-anchored description than a human-written one would give.
  - Cost impact is small: one extra generation call plus one vision-model read per character or scene, NOT per shot, against the volume of low-quality shots it informs.
  - Tier selection routes through the existing config-driven registry (`config/image-models.json` plus per-channel `config.json`), with quality as an added field alongside model choice, not hardcoded per call site. For example: `{ "image_model": "gpt-image-2-developer", "quality": "low", "reference_quality": "high" }`.
- **YouTube OAuth not configured for Channel A** (deliberately deferred). The approval handler's upload path is coded and unit-tested against a mocked HTTP layer, but nothing auto-uploads until `CHANNEL_A_YOUTUBE_*` credentials plus OAuth verification exist. Two live tests remain deferred: a real upload, and YouTube honoring `status.containsSyntheticMedia`.
- **Channel B needs a policy-risk decision** before any build work (Inauthentic Content enforcement, Part 3).
- **`vpcheck` repair loop** (queued, `tasks/backlog.md`): a repeated framing phrase ("over-the-shoulder wide establishing shot") can survive across multiple shots despite being in the avoid-list; qwen re-emits it within `maxAttempts=2`.
- **Shot window sizing** (queued): first live run averaged 2.68s per shot, tight versus the 2.5 to 3s target, inflating shot count, cost, and repair pressure on dense scripts.
- **Poller collect error handling** (queued): a transient status-GET failure is treated as terminal `stills_failed` rather than distinguished from a real FAILED batch state.
- **Channels C, D, E** have no committed code. Part 3 status is the source of truth until build work begins.

---

## APPROVAL HANDLER — FULL MECHANIC (Section 03a)

Built across `0787406`, `8e0657e`, `0cf687a`, `e89719b`. All five steps committed.

- **State model.** `publish.js` sends the bundled approval message and persists `tg_message_id` / `tg_chat_id` to the row (migration 002). `flyt-approvals.js` runs one pass per launch on a LaunchAgent (`com.openclaw.flyt-approvals.plist`, `StartInterval` 300s), long-polling `getUpdates` with a persisted offset so no update is processed twice.
- **Matching.** A reply is matched to its row by `reply_to_message.message_id` scoped to `tg_chat_id` and `status='pending_approval'`. Fallback: a bare command with exactly one pending row in the chat resolves to it; more than one refuses to guess.
- **Bundled grammar** (matches the caption in `publish.js`): `approve all | approve long | approve short_[n]` and `reject [item] [reason]` where item is `all | long | short_n` (optional). A bundle is one long-form parent row plus its `short` children (`parent_video_id`, ordered by id). `resolveBundle` gathers the bundle; `targetsForCommand` maps scope to rows and returns a clean error for a nonexistent `short_n`. Already-handled items are skipped silently. 30 unit tests in `tests/test_approvals.js`.
- **Approve path.** Records `status='approved'`. A decoupled upload pass runs every invocation and drives every approved row to YouTube (`lib/youtube.js`, raw-https resumable `videos.insert`, sets `status.containsSyntheticMedia = true` and `selfDeclaredMadeForKids = false`), then to `status='published'` with `youtube_video_id`, and cleans up `tmp/<slug>/`. A failed upload stays at `approved` and retries next pass (covers the Section 04a 7-day refresh-token expiry).
- **Reject path.** Records `status='rejected'` with `reject_reason`. tmp assets are intentionally kept.
- **Current runtime status.** The plist is installed at `~/Library/LaunchAgents` but NOT yet `launchctl load`-ed. YouTube OAuth is unconfigured, so the upload path fail-softs. Reply handling and state transitions work today.

---

## TRACKING DATABASE (Section 00c)

SQLite at `db/tracking.db`. Not Postgres, not Supabase. Core table `videos`.

Statuses beyond the original doc: `awaiting_stills`, `stills_failed`, `stills_stale`, `abandoned`, `qa_blocked`, plus the approval states `pending_approval`, `approved`, `rejected`, `published`.

Columns added since v2.7: `batch_job_id`, `batch_submitted_at` (migration 001); `parent_video_id`, `video_type` (multi-shorts data model); `tg_message_id`, `tg_chat_id`, `youtube_video_id` (migration 002). `video_type` is `long_form` (default) or `short`; a short's `parent_video_id` points at its long-form parent.

---

## COMPONENT MAP

- `agents/flyt-orchestrator.js` — Phase 1 driver.
- `agents/flyt-poller.js` — Phase 2 driver.
- `agents/flyt-approvals.js` — Phase 3 approval/upload driver.
- `agents/flyt-script-generator.js` — two-stage script.
- `agents/lib/groq.js` — Stage 1 prose prompt (persona + gap dynamics + Story Ladder).
- `agents/lib/personas.js` — frozen Section 06 persona text.
- `agents/lib/qwen.js` — Stage 2 scene JSON + shot-prompt regeneration.
- `agents/lib/qa.js` — blocking QA gate (`voice_consistency`, `gap_logic` blocking; threshold 7).
- `agents/lib/manifest.js` — normalize + validate scenes.
- `agents/lib/shots.js` — shot segmentation.
- `agents/lib/vpcheck.js` — visual-prompt distinctness audit/repair.
- `agents/lib/publish.js` — Cloudinary + Telegram (shared).
- `agents/lib/models.js` / `agents/lib/image_providers.py` — image-model registry resolvers (JS + Python, one source of truth).
- `config/image-models.json` — image-model registry (model, auth, endpoints, cost).
- `agents/lib/youtube.js` — raw-https YouTube uploader.
- `agents/flyt-narrator.py`, `flyt-align.py`, `flyt-stills.py`, `flyt-hero.py`, `assemble.py`, `validate.py`, `alert.py`.
- `launchd/com.openclaw.flyt-poller.plist` — Phase 2 scheduler (15 min). Approval-handler plist lives at `~/Library/LaunchAgents/com.openclaw.flyt-approvals.plist` (5 min).
- `tasks/lessons.md` — hard-won corrections, read before touching anything.
- `tasks/backlog.md` — deferred follow-ups.

---

## PRESERVED HARD RULES

- Never publish a video without Telegram approval (Section 03a).
- Never skip the QA/accuracy pass before generation (Section 03 step 2 / the blocking gate).
- Never proceed past a failed validation without retry-once-then-alert.
- Never use Higgsfield or RunPod credits for this pipeline (Section 12).
- Atlas Cloud is the hero-video provider (Seedance 2.0), key `ATLASCLOUD_API_KEY`. The original doc naming BytePlus/ModelArk was wrong.

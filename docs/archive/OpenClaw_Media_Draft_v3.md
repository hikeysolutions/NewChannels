# OpenClaw Media — Consolidated Working Doc (DRAFT v3)
**Status: DRAFT — requires Claude Code verification against live repo before becoming canonical**

---

## HOW TO USE THIS DOCUMENT

This draft was assembled from a planning conversation, NOT from direct repo inspection. It contains real decisions and content that do not yet exist anywhere in the New Channels codebase, alongside claims about pipeline state that must be verified before being trusted.

**Instructions for Claude Code:**
1. Do not treat any "pipeline state" claim in this doc as fact until you've checked it against the actual repo (code, DB schema, git log, tasks/lessons.md, STATE-SINCE-v2.7.md).
2. Sections marked **[UNVERIFIED — CHECK REPO]** need direct confirmation.
3. Sections marked **[NEW CONTENT — NOT YET IN CODEBASE]** are real content from planning discussion that needs to be added to the codebase (prompts, docs, etc.) — these are not claims about existing state, they're instructions to implement.
4. Once verified/reconciled, this should replace `New_Channels_Master_Build_v2_7.md` and `docs/STATE-SINCE-v2.7.md` as the single canonical doc, per this project's own standing rule: **specs are unified single files, never addenda.** Archive the superseded docs once this is confirmed accurate.
5. Where this doc conflicts with what you find in the repo, the repo wins — flag the conflict back to the user rather than assuming this doc is right.

---

## PART 1 — CHANNEL A ("Before Now") — ACTUAL PIPELINE STATE

**[UNVERIFIED — CHECK REPO — this section is a reconstruction from conversation, confirm every line against actual code/commits/DB before trusting]**

### Architecture (as of this planning session)

Channel A has moved from v2.7's original synchronous 10-step pipeline to a two-phase async architecture:

**Phase 1 (synchronous, orchestrator-driven):**
1. Combo picked from `entity_situation_bank`
2. Script generation (two-stage: Groq/Cerebras prose → local qwen scene-JSON conversion)
3. QA gate (blocking on `voice_consistency` and `gap_logic`; `factual_accuracy` demoted to advisory/non-blocking per explicit decision — logged for weekly human review, not a hard gate)
4. Narration (VoxCPM2, local, CPU-only on this hardware, 48kHz, voice-cloned from a fixed reference clip — NOT the default/undesigned voice)
5. Forced alignment (stable-ts) — produces word/beat-level timestamps from the real generated audio
6. Shot segmentation — content-driven cuts at ~2.5-3s cadence (NOT a fixed timer; driven by alignment + clause boundaries)
7. Shot-prompt generation (qwen) + deterministic `vpcheck` gate — catches near-duplicate visual prompts and non-visual/audio-only language (e.g. "crackling," "whispering") before submission
8. Batch submission to image-gen API — Phase 1 ends here, video status → `awaiting_stills`

**Phase 2 (async, LaunchAgent poller, ~15 min cadence):**
9. Poller collects completed batch, downloads stills
10. Assembly (`assemble.py`, plain ffmpeg — HyperFrames/Remotion evaluation remains deliberately deferred)
11. Publish: Cloudinary upload + bundled Telegram approval message
12. **[UNVERIFIED — CHECK REPO]** Approval-reply-handler (separate LaunchAgent, `flyt-approvals.js`) — listens via Telegram `getUpdates` polling (not webhook), matches replies to rows via `reply_to_message.message_id`, handles approve/reject, and (per this session) now includes YouTube upload on approve. Confirm current build status — last known state was "steps 1-3 committed (migration, reply handler, YouTube uploader), steps 4-5 (bundled multi-shorts parser, LaunchAgent deployment) in progress."

### Key fixes applied this session (verify each is actually committed):
- **Persona injection**: Section 06's full "Reluctant Witness" persona was previously *specified but never wired into the generation prompt*. Fixed — injected into Groq's system prompt in `lib/groq.js`. Verified improvement: voice-consistency score 2/10 → 8/10 on the same test combo.
- **Sample-rate bug**: VoxCPM2 output was hardcoded/mislabeled at 16kHz when actual output is 48kHz, causing "slowed down monster voice" distortion (3x speed/pitch error). Fixed to read `model.sample_rate` at runtime rather than a hardcoded constant.
- **Voice consistency**: Narrator had no locked voice — every scene used the model's default, non-deterministic voice, causing audible voice changes scene-to-scene. Fixed via reference-clip cloning (`ChannelA/voice/narrator_a.wav` + `.txt`), verified via F0 (pitch) analysis: scatter collapsed from ~35 Hz STD to ~2.4 Hz STD across differently-worded clips, all pinned to the reference's ~116 Hz.
- **Visual style**: Originally locked as "photorealistic" — this was **wrong**. The actual reference format (Zenn's channel) uses minimalist 2D stick-figure/vector illustration. Corrected in `ChannelA/STYLE_GUIDE.md` and `flyt-stills.py`'s prompt construction.
- **Era/subject drift**: Original test video rendered "modern campers" instead of ancient humans for several scenes due to prompts losing era-context. Fixed via a structured `render` block per scene/shot (`era`, `location`, `subject_type`, `style`), validated with a controlled vocabulary (fail-fast, same pattern as `gap_type`).
- **Pacing**: Original cuts were 10-12 seconds — too slow. Corrected to ~2.5-3s content-driven cuts via forced alignment (not a fixed timer), matching the actual reference format's stated 3-5s cadence.
- **Hero/video clips removed for Channel A**: Channel A is now stills-only — no Seedance video clips. (Channel B, if built, keeps hero clips — this change is Channel-A-specific.)
- **Gap-chain stagnation**: The script generator was producing all-"opens"-then-"resolves" chains (no `partial_resolve`), which correctly tripped the `gap_logic` QA gate every time. Root cause: Stage-1 prose prompt had no instruction to build/pay off tension mid-script. Fixed via explicit prompt guidance (early `partial_resolve`, no more than N consecutive opens); QA gate threshold also recalibrated (verify final value — was discussed as landing at 7, confirm against committed code) to correctly admit the format's legitimate "explainer belly" (a curiosity-format script naturally introduces several facts in a row before circling back).
- **Deterministic visual-prompt repair**: Prompt-tightening alone did not reliably stop qwen from producing near-duplicate visual prompts or leaking non-visual language (audio cues, atmospheric-only descriptions) into image prompts — this hit a ceiling on the local 7B model. Fixed via a deterministic post-generation checker/repairer (`vpcheck.js`) that detects and regenerates offending scenes, falling back to a QA flag (never silently ships a bad scene unflagged).

### Cost model — **[UNVERIFIED — CHECK REPO, confirm current real numbers]**
- Original v2.7 estimate: $0.30-0.80/video (stills + hero via synchronous per-call pricing)
- Post-pacing-fix (more, shorter cuts) at Gemini NB2 Lite standard pricing: significantly higher (~$5-8/video at 8-10 min length)
- Switched to Gemini Batch API pricing (50% discount, async): ~$0.02-0.04/video at this length — real observed spend on first live batch run: **$0.816 for 48 shots** (video: "What Did Aztecs Do Before A Wedding")
- **In progress at time of this doc**: migrating Channel A's still-generation off Gemini entirely, onto GPT Image 2 via Atlas Cloud (~$0.008-0.009/image vs Gemini's $0.017/image batch rate — confirmed via direct, live-tested comparison: GPT Image 2 held both stick-figure and photorealistic character/style consistency flawlessly across multiple sequential test prompts). A model-provider abstraction layer (config-driven registry + adapter pattern) is being built specifically so future model swaps are a config change, not a rewrite. **Confirm status of this work before assuming it's complete.**

---

## PART 2 — NARRATIVE CRAFT RULES (Story Ladder) — **[NEW CONTENT — NOT YET IN CODEBASE]**

**This entire section may not exist in the repo yet. If `lib/groq.js` does not already contain these rules, add them to the Stage-1 system prompt, layered on top of (not replacing) the existing Section 06 persona rubric and gap-dynamics block.**

Source: an annotated breakdown of Kallaway's "Story Ladder" framework applied directly to the actual Zenn video ("What Did Ancient Humans Do at Night?") this format is copying. This is more specific and testable than generic "write a good script" guidance.

### The four rules:

1. **GENUINE MISDIRECTION, NOT JUST NEW FACTS.** At least one beat must state a belief the viewer already holds (a common assumption, an expected explanation) and then flatly invert it — not just add new information, but reverse an expectation. Shape: "You'd assume X. You'd be wrong — it's actually Y." This is stronger than the existing `gap_type` taxonomy's "contradiction" — the reversal must feel like a genuine rug-pull.
   - Real example from the reference video: sets up "waking at 2am is a medical malfunction" → inverts to "it's not a disorder, it's 300,000 years of evolutionary programming working correctly."

2. **NESTED LOOPS PER TOPIC.** Each major topic/fact-cluster should internally complete a closed loop before moving to the next: **WHAT** (the claim) → **WHY** (the mechanism/reason) → **EXAMPLE** (a concrete case, study, or scene) → **TAKEAWAY** (what it means). Don't leave a topic half-explained before jumping to the next one — each loop closes before a new one opens, even as the larger gap-chain across the whole script continues building tension.
   - Real example: "Fire loop" — what (humans conquered fire) → why (kept predators away, extended usable day) → example (a specific anthropological study) → takeaway (this is where human culture began).

3. **EARLY PERSONAL STAKES.** Within the first two beats, make clear this isn't abstractly about the entity/situation combo — it's about the viewer's own body/behavior/life today. Ground historical/factual content in something the viewer currently experiences.
   - Real example: framing ancient sleep patterns around "why can't YOU sleep tonight," not just "ancient humans slept differently."

4. **NO TACTICAL CLOSER.** The final beat must NOT resolve into practical advice or a tidy "here's what you should do" wrap-up. End on an open, resonant, slightly haunting image or observation that leaves something unresolved — consistent with the persona's existing "Permitted ambiguity: high" rule in Section 06.
   - Real example: the reference video ends not with sleep-hygiene tips, but with the viewer imagining looking up at a lost, pre-electric night sky.

### Implementation note:
After adding, regenerate the same test combo used for the original persona fix (or a fresh combo) 3-5 times, text-only, no spend. Re-score against the existing Voice Consistency rubric AND qualitatively confirm each of the four rules is actually showing up in output — not just that the numeric score moved. Commit as its own isolated change.

### Reference material (for humans, not for runtime prompt injection):
Keep the full Kallaway Story Ladder breakdown and the annotated Zenn transcript as reference docs (e.g. `docs/references/story-ladder.md`, `docs/references/zenn-ancient-humans-annotated.md`) for future prompt-tuning sessions — do NOT inject the raw transcript into the live generation prompt. The distilled rules above are what should live in the actual system prompt; the source material is for human/future-session reference only.

---

## PART 3 — CHANNEL ROADMAP — **[NEW CONTENT — mostly not in codebase, confirm what overlaps with existing doc]**

Five channels total, tracked here with real status. Per external research conducted this session: realistic operator bandwidth tops out around 2-3 actively-managed channels — this list is a backlog, not a parallel build plan.

### Channel A — "Before Now" (BUILT, in active refinement)
Historical curiosity format, locked. See Part 1 for full pipeline detail. Currently the only channel with real, tested infrastructure.

### Channel B — Countdown/Listicle (PLANNED, not built — name still TBD, "Ten Deep" rejected)
Original v2.7 doc concept: "Top 10 X You'll Regret" style, shares Channel A's underlying agent codebase via `--channel` parameterization. **Flag for reconsideration**: research conducted this session identified a real content-policy risk — YouTube's 2025 "Inauthentic Content" policy enforcement wave specifically targets templated, noun-swapping listicle formats. Do not build without addressing this risk assessment first, independent of anything else in the queue.

### Channel C — "FailNation" (PLANNED, next in build queue after Channel A stabilizes)
30-60 second comedic "fail" shorts. **Content scope, confirmed and locked: young adults and animals only — no depiction of minors/children/teens**, specifically to avoid any ambiguity around real-person-likeness and minor-safety policy questions across every model provider's ToS. Always resolves safely/unharmed — slapstick, not real harm. Original AI-generated characters only, no real people. Storyboard-still generation confirmed working excellently on GPT Image 2 (both photorealistic and stylized tested, flawless character/style consistency across sequential prompts). Video-generation model not yet finalized — Pixverse C1 standard tier was researched as compliant and reasonably priced; since content is now young-adults-only (no minors), cheaper Spicy/uncensored-tier models also become viable options and should be re-compared on cost/quality before committing.

### Channel D — "Fun History"-style long-form (PLANNED, concept-stage)
12-20 minute compressed historical timelines. Single narrator voice (not multi-character voice acting — this was clarified/simplified from an earlier draft of the concept). Three-layer visual style: real historical photography base layer + vector map/text overlays + flat 2D cartoon character overlays for comedic reaction beats. Needs its own name (working title collided with an existing real channel called "Fun History" — do not use that name). No technical build work started.

### Channel E — "Fish Outta Water" (PLANNED, lowest priority — character design not started)
30-60 second shorts featuring wholly original (no real people, no existing IP) character(s) dropped into high-stakes/absurd premium-aesthetic scenarios (VIP events, reality-competition chaos, high-roller nightlife). Cinematic/luxury visual identity (metallic gold/platinum, high-contrast lighting). Deliberately sequenced last — per the operator's own stated reasoning, this format requires character design → visual style → everything else, in that order, unlike the other channels where format/pipeline can be built before creative specifics are fully locked. Real research risk flagged: building genuine audience/parasocial attachment to a wholly new character with no prior recognition is the hardest unsolved problem of the five channels — real case studies exist (Lil Miquela, Neuro-sama) proving it's possible, but it takes deliberate technique (consistency-as-authenticity, not backstory dumps).

---

## PART 4 — CONTENT POLICY / COMPLIANCE — LOCKED RULES

**This section should be treated as a hard, non-negotiable constraint on all current and future channels, not a per-project judgment call. It exists because this exact question came up multiple times this session and needs to stop being re-litigated.**

### Real people — prohibited, no exceptions found
Do not generate synthetic video/image content depicting real, identifiable people (living or deceased) without their explicit, specific, written consent covering AI/synthetic likeness use — general "they'd probably be fine with it" or an existing informal relationship is NOT sufficient consent for this specific use case.

Real, current legal basis (not just platform ToS): the ELVIS Act (Tennessee, but explicitly extraterritorial — applies regardless of where the creator or the depicted person resides) and the federal NO FAKES Act (advancing through the Senate as of this session) both create enforceable property rights over a person's voice/likeness, with liability extending to "developers or distributors of technology whose primary function is the unauthorized production of an individual's likeness" — meaning building a *system* to do this repeatedly is its own distinct legal exposure, separate from any single video's fate.

### Copyrighted characters — prohibited, including "suggestive" or altered versions
Do not generate characters that are recognizably derived from existing copyrighted IP (film/TV characters, etc.), even with altered details. Legal and platform enforcement standards are based on "substantial similarity" / recognizability, not exact-match identity — a deliberately-recognizable "similar but not identical" version does not avoid infringement; if anything, intentional recognizability is evidence the resemblance isn't coincidental.

### Depicting minors in AI-generated content — resolved by avoidance, not by policy-reading
For any content involving people in physical/comedic scenarios (e.g. FailNation's fail-content format): default to **young adults only, no children or teens**. This was researched in depth (direct primary-source ToS review of Pixverse, Seedance, Vidu) and a defensible reading exists that safe/non-exploitative depictions of minors are technically permitted on standard tiers — but automated content-moderation enforcement is imperfect and more likely to flag content involving children regardless of the technically-correct policy reading, and there's no upside to carrying that ambiguity when the format works equally well with adult characters. Locked decision: **avoid entirely, don't rely on the permissive reading.**

Separately, hard rule with zero ambiguity: **Spicy/uncensored model tiers require an explicit 18+-only confirmation on every API call** (verified directly from Atlas Cloud's own model documentation) — never use these tiers for any content that could depict a minor, full stop, regardless of context or framing.

### "Uncensored tier as a workaround" — not a valid strategy
Routing ambiguous or restricted content through a Spicy/uncensored API tier to bypass a standard tier's content restriction does not reduce legal or platform risk — it only shifts where the restriction is enforced (upload-time platform detection instead of generation-time API refusal). Content policy risk should be resolved by not generating the content, not by finding a provider willing to generate it.

---

## PART 5 — OPEN ITEMS / KNOWN GAPS

**[Confirm current status of each against repo before treating as still-open]**

- YouTube OAuth not yet configured for Channel A (deliberately deferred — no working upload demo existed to support a verification submission; revisit once the approval-handler's upload path is tested)
- Image-model abstraction layer (config-driven registry, GPT Image 2 migration) — status at time of this doc: design phase, not yet built against Channel A's live pipeline
- Approval-reply-handler — steps 1-3 committed (schema migration, Telegram reply matching, YouTube uploader code), steps 4-5 (bundled multi-shorts parser, LaunchAgent deployment) — confirm current status
- Story Ladder narrative craft rules (Part 2) — confirm whether added to `lib/groq.js` yet
- `vpcheck`'s repair loop has a known, queued (not urgent) improvement: repeated framing phrases can survive across multiple shots despite being in the avoid-list; also the ~2.68s average shot window came in tighter than the 2.5-3s target, possibly contributing to higher repair rates on dense scripts
- Channel B (Countdown/Listicle) needs a policy-risk decision before any build work, per Part 3
- Channels C, D, E have no committed code — Part 3 status stands as the source of truth until build work begins

---

*This draft supersedes `New_Channels_Master_Build_v2_7.md` and `docs/STATE-SINCE-v2.7.md` once verified. Per this project's standing rule, specs are unified single files — archive the superseded docs rather than maintaining them alongside this one.*

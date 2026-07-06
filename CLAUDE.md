# NewChannels Pipeline. Claude Code Rules
# Boris Formula starter template (Master Doc Section 00b / Section 09)

## What This Is
Five-channel YouTube automation pipeline (A built, B planned/build-ready, C-E at varying earlier stages). All channels share ONE flyt- agent set, parameterized by --channel. Fully isolated stack: no RunPod, no Higgsfield, no shared-gateway credits.

## Shared vs Channel-Specific (LOCKED BOUNDARY)
Channels B, C, D, and E inherit Channel A's shared infrastructure and mechanics ONLY: the flyt-
agent set, the LLM/image provider registries, the QA gate, the assembly pipeline, and the Telegram
approval flow (Section 03c, "6 shared agent files, not 12"). They inherit NONE of Channel A's
specific creative tuning. Each channel gets its own persona (Section 06 discipline), its own prompt
content, its own length target, its own thumbnail treatment, and its own active provider choices.
Never copy Channel A's "Reluctant Witness" persona, Story Ladder/Kallaway prompt content, length
target, or provider selection into another channel. Each channel's creative direction is
independent. The only rules shared across every channel are the two non-negotiable content rules
(no real-person likeness, no depiction of minors, Part 4), already locked and already followed.

## Stack
- Script gen: provider registry (config/llm-models.json), resolved by lib/llm_registry.js. Groq primary, Cerebras fallback. Prompt built in lib/groq.js.
- Stills: image provider registry (config/image-models.json), resolved by lib/image_providers.py. Per-channel active model in ChannelX/config.json.
- Narration: VoxCPM2, local, reads the model's real sample rate at runtime.
- Assembly: ffmpeg (assemble.py) cuts stills to shot timings over the narration. HyperFrames vs Remotion (Section 09) stays deferred.
- Approval + delivery: Cloudinary host, Telegram approve/reject (flyt-approvals.js, flyt-poller.js).
- Tracking: SQLite in db/.

## Session Rules
- Run /plan before any non-trivial task (3+ steps). Plan first, then build.
- One task per session. One agent, one feature, one fix.
- Stop and re-plan if anything goes sideways. Never push through.
- Verify with real output before marking done. No "should work".
- Commit at session end with a version number.

## Never Do
- Never publish a video without Telegram approval (Section 03a).
- Never skip the QA/accuracy gate before generation (Section 03, step 2).
- Never bypass a qa_blocked video. A blocking flag is a hard stop, honor the retry-once-then-alert path (Section 03, step 6).
- Never use Higgsfield or RunPod credits for this pipeline (Section 12).

## Current Phase
Channel A first real end-to-end long-form runs (4 to 5 min). Atlas GPT Image 2 live as the active still provider, Gemini NB2 batch verified as fallback. Groq length-target block strengthened, result pending verification.

## Model Routing
- Default: Opus 4.8 for scoped, single-outcome sessions.
- Fable 5 for genuinely ambiguous work: first-run architecture calls and first end-to-end debugging.
- If a scoped session turns into multi-attempt debugging, switch to Fable 5 mid-session (/model fable) rather than grinding on Opus.
- Full rationale: Section 10 of the Master Doc.

## Channel Configs
Each ChannelX/CLAUDE.md holds that channel's specifics (persona, title/format, active providers, QA
gate), calibrated to its actual maturity. Creative direction is independent per the LOCKED BOUNDARY above.
- ChannelA/CLAUDE.md — built, active refinement (persona, title formula, active providers, QA gate).
- ChannelB/CLAUDE.md — planned, build-ready. "The Survivor" persona, countdown title formula locked; name TBD, providers/length to set.
- ChannelC/CLAUDE.md — "FailNation", most build-ready of C-E. Scope locked, GPT Image 2 confirmed; open item is the video-gen model choice.
- ChannelD/CLAUDE.md — concept-stage long-form. Single narrator + three-layer visual approach agreed; no pipeline, no name.
- ChannelE/CLAUDE.md — "Fish Outta Water", placeholder. Sequenced last (character design first); parasocial-attachment risk flagged.

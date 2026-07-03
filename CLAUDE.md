# New Channels — Claude Code Rules
## What This Is
Two-channel YouTube automation pipeline. Channel A ("Before Now") — historical curiosity format. Channel B (name TBD) — countdown/listicle format. Shared flyt- agent set, parameterized by --channel. No RunPod, no Higgsfield credits — fully isolated stack.
## Stack
Claude Code/Groq (script), Gemini NB2 Lite (stills), BytePlus/Seedance (hero shots), VoxCPM2 local (narration), Remotion/HyperFrames (assembly), Cloudinary + Telegram (approval), SQLite (tracking).
## Session Rules
- Always run /plan before any non-trivial task
- One task per session — one agent, one feature, one fix
- Stop and re-plan if anything goes sideways
- Verify with real test before marking done
- Commit at session end with version number
## Never Do
- Never publish a video without Telegram approval (Section 03a)
- Never skip the QA/accuracy pass before generation (Section 03, step 2)
- Never proceed past a failed validation without retry-once-then-alert (Section 03, step 6)
- Never use Higgsfield or RunPod credits for this pipeline (Section 12)
## Current Phase
Session 0 — folder structure, tracking database, workflows-engineering skill install.
## Model Routing
- Default: Opus 4.8 for scoped, single-outcome sessions (Sessions 0, 1, 2, 5, 6+)
- Fable 5 for ambiguous architecture decisions (Session 3 — HyperFrames vs. Remotion) and first end-to-end pipeline test/debugging (Session 4)
- If a session unexpectedly turns into multi-attempt debugging, switch to Fable 5 mid-session (`/model fable`) rather than pushing through on Opus
- Full rationale: Section 10 of the Master Build doc
## Port Registry
6420 — FlytBot health endpoint (suggested, confirm against OpenClaw port registry before final assignment)

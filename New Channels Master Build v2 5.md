# New Channels — Master Build Document v2.5
**Fast-Revenue YouTube Automation Pipeline**
Michael Bryant II (Banc) — July 2026
**Priority: This launches before RHI, Bible Channel, or any other Banc project. No dependencies on other builds.**

---

## CHANGELOG: v2.4 → v2.5

| Section | Change |
|---|---|
| 10 — Build Session Plan | Added a per-session model routing column: Opus 4.8 as default for scoped, single-outcome sessions (0, 1, 2, 5, 6+), Fable 5 for genuinely ambiguous or first-end-to-end-run sessions (3, 4), with a mid-session switch rule if a scoped session unexpectedly turns into multi-attempt debugging. |
| 00b — Folder Structure | Added a `## Model Routing` block to the `CLAUDE.md` starter content so the routing policy is written into the pipeline's own rules file in Session 0, not just this doc — persists for any future session or fresh Claude Code instance reading `CLAUDE.md`. |

## CHANGELOG: v1.0 → v2.0

| Section | Change |
|---|---|
| 02 — Production Stack | Local TTS tool specified: VoxCPM2 (Apache-2.0) via VoxCPMANE backend for Apple Neural Engine. Replaces placeholder "already replaced Chatterbox" line. |
| 03 — Pipeline Architecture | Step 6 validation loop pattern sourced from OpenMontage's review-gate design (ffprobe check, frame extraction, audio level check) — pattern borrowed and hand-coded, not installed as a dependency. |
| 09 — Assembly Layer | Decision made: test HyperFrames via Open Design install rather than standalone `npx skills add` install. One tool instead of two. |
| NEW — Section 00a | Tool stack decisions and rationale added, including what was evaluated and explicitly rejected for this pipeline. |
| NEW — Section 13 | Full install instructions for every adopted tool. |
| 10 — Build Session Plan | Session 0 now includes workflows-engineering skill install as a prerequisite step. |
| 05a — Watchdog | Agent-Reach noted as a Session 6+ candidate for outlier-scanning automation — confirmed, not installed early. |

## CHANGELOG: v2.0 → v2.1

| Section | Change |
|---|---|
| NEW — Section 00b | Folder structure creation added as an explicit first step before any Session 0 file writes. Previously assumed, never actually specified. |
| NEW — Section 00c | Tracking database decision: local SQLite, not Postgres, not Supabase. Full rationale plus schema. |
| 05 — Outlier-Scanning Engine | Wired the outlier-scanning workflow into the new SQLite tracking layer — new entity/situation tangents and new-format candidates now have a defined landing place instead of only a Google Sheet. |
| 10 — Build Session Plan | Session 0 now includes folder structure + SQLite init as explicit steps. |
| 13 — Tool Install Instructions | Added Section 13.5 — SQLite init script. |

## CHANGELOG: v2.1 → v2.2

| Section | Change |
|---|---|
| 00b — Folder Structure | All agent files renamed with `flyt-` prefix. `flyt-` is this pipeline's agent family name, same convention as Susan/James/Marva/BigJoe elsewhere in the portfolio. |
| 03a — Human-in-the-Loop Approval | Fully specified for the first time. Previously described the approval concept only, not the actual delivery mechanic. Now defines Cloudinary upload + Telegram link pattern, matching every other pipeline in the portfolio. |
| NEW — Section 02a | Cloudinary added to the tech stack, dedicated New Channels folder for asset isolation. |
| NEW — Section 03c | Confirms all 6 agents are shared across both channels, parameterized by `--channel` flag, not duplicated per channel. |
| 13 — Tool Install Instructions | Added Section 13.6 — FlytBot Telegram bot setup. |

## CHANGELOG: v2.2 → v2.3

| Section | Change |
|---|---|
| 13.2 — VoxCPM2 Install | Test command no longer references `~/OpenClaw/BibleChannel/Characters/voice-sample.wav` — that file does not exist (Bible Channel's Characters/ folder is empty; the reference WAV was deleted, per the Master Build doc's open blocker). Replaced with VoxCPM2's Voice Design mode (text-description-only, no reference audio required) so Session 1/2 prep has no dependency on a file that doesn't exist. Reference-clip cloning remains available as a later option once channel voices are locked in — see note at end of 13.2. |

## CHANGELOG: v2.3 → v2.4

| Section | Change |
|---|---|
| 00b — Folder Structure | Environment folder pattern added — this pipeline previously had no `CLAUDE.md`, `REFERENCES.md`, or `tasks/lessons.md` anywhere in its tree, unlike every other business in the portfolio. Now has one shared `CLAUDE.md` + `tasks/lessons.md` at the `NewChannels/` root (pipeline-wide rules and corrections), plus a `REFERENCES.md` + `tasks/lessons.md` per channel (channel-specific examples and corrections) — mirrors the Higgsfield/Hikey two-tier pattern of shared skills + per-brand/client files. |
| 00c — Tracking Database | Added `qa_flags` table — Section 03 step 2's "log flagged items" instruction previously had no defined table to write to. |
| NEW — Section 00d | `.env` template added — this pipeline previously had no consolidated environment variable reference, unlike RHI (Section 11 of its own doc). Covers shared API keys, channel-prefixed YouTube OAuth credentials, FlytBot, and a monthly budget variable for Watchdog to check against. |
| 04 — Account Structure | Added 04a — OAuth verification requirement. Google issues 7-day-expiring refresh tokens for unverified/Testing-mode OAuth apps; this silently breaks unattended uploads about a week after everything else works. Verification review takes real time, so this needs to start now, not at Session 4. |
| 10 — Build Session Plan | Session 0 now explicitly includes writing starter `CLAUDE.md` content using the Boris Formula template (Boris Hooks doc, Section 09) — previously implied, not stated. |
| 11 — Immediate Action Items | Added: start Google OAuth consent screen verification now (parallel to build, not after). Added: extend `subagent-start.js` to read from `NewChannels/` paths, since this pipeline sits outside `Brands/` where the hook currently looks. |

---

## 00. WHY THIS EXISTS

RHI and Walking in the Way are longer monetization plays — RunPod dependency, avatar animation, heavier infrastructure. This build is deliberately the opposite: minimal human interaction, minimal cost, fast to revenue. Goal is to generate consistent income from these channels to free up time and capital to produce RHI/Bible Channel and replicate this system into more channels once proven.

Core principle, from Adavia's framework: **steal formats, not niches.** Don't guess at content — find outlier videos that are already massively outperforming their channel size, copy the proven structure, swap the subject matter.

---

## 00a. TOOL STACK DECISIONS — WHY THESE AND NOT OTHERS

This pipeline was explicitly designed to avoid the shared-cost, shared-infrastructure weight of RHI and Higgsfield (see Section 02, Section 12). That same discipline applies to tooling. Every candidate tool was evaluated against one question: **does this reduce friction or add a competing orchestration layer?**

### Adopted — see Section 13 for install steps

| Tool | Role | Why |
|---|---|---|
| **VoxCPM2 + VoxCPMANE** | Local narration TTS | Apache-2.0, zero marginal cost, runs on Apple Neural Engine — a separate chip from what the rest of the Mac Mini's agents compete over. Single local call fits the existing async pattern. |
| **HyperFrames (via Open Design)** | Assembly / motion graphics layer | Section 09 already called for evaluating HyperFrames vs. Remotion. Getting it through Open Design (already being installed for other businesses) avoids a second standalone install. |
| **workflows-engineering skill** | Claude Code reference for pipeline design | Documentation only, zero runtime footprint. Informs how the orchestrator, phases, and stop-rules get structured from Session 0 onward. |

### Pattern borrowed, not installed

| Source | What was taken | Why not installed directly |
|---|---|---|
| **OpenMontage** | Post-render validation pattern: ffprobe check, frame extraction at 4 positions, audio level analysis, retry-once-then-alert | OpenMontage is a full agentic orchestration system with its own manifest format and approval-gate structure. Running it alongside this pipeline's own orchestrator means two competing frameworks managing the same job. The validation *logic* (roughly 40 lines) is copied into `validate.py` as plain code instead. |

### Evaluated and explicitly not used here

| Tool | Reason |
|---|---|
| **ClinePass** | Switching models mid-build (Groq for one session, DeepSeek for another, Claude for architecture) breaks continuity across a 6-session build where later sessions depend on schema decisions made earlier. File for post-launch maintenance work only, not initial build. |
| **Agent-Reach** | Section 05a already scopes outlier-scanning automation as a Session 6+ item, after the core pipeline is proven. Installing it now solves a research problem before there's a publishing problem to research. Revisit at Session 6. |
| **Artlist Max/Creator** | Bundled Seedance access is tempting but Artlist's terms explicitly forbid automation, and this pipeline requires programmatic API polling (Section 03 step 4), not manual browser generation. Also breaks the deliberate "isolated, pay-per-use, non-shared" cost design in Section 02. |
| **Palmier Pro** | GUI editing tool built for manual human-at-the-keyboard sessions. This pipeline needs headless API calls, not an app that has to stay open. Filed for Archouse client editing work instead. |
| **GBrain / knowledge-base tooling** | This pipeline has no lore-continuity or knowledge-compounding requirement the way RHI or Walking In The Way do. Not applicable. |

**Net result:** three lightweight additions (one local model, one feature inside a tool already being installed elsewhere, one reference doc), one borrowed code pattern, and three deliberate deferrals. Nothing here adds a second orchestration layer on top of the pipeline's own architecture in Section 03.

---

## 00b. FOLDER STRUCTURE — CREATE BEFORE ANY SESSION 0 FILE WRITES

Every session from Session 0 onward assumes this structure exists. It does not exist yet. This is the actual first step of Session 0, before the workflows-engineering skill install and before any style guide gets written.

**Environment folder pattern (new in v2.4):** every other business in the portfolio follows the standard `CLAUDE.md` / `REFERENCES.md` / `tasks/lessons.md` pattern documented in the OpenClaw Environment Folder Guide, so Boris hooks (`subagent-start.js`, `dream.js`) have a defined place to inject lessons into and write new ones back to. New Channels previously had none of this. It follows the same two-tier shape already proven by Higgsfield (one shared skill set, per-brand `CLAUDE.md`) and Hikey (one business-level `CLAUDE.md`, per-client `tasks/lessons.md`):

- **Shared, one copy at the `NewChannels/` root** — `CLAUDE.md` (pipeline-wide mechanics: validation-before-assembly, never publish without Telegram approval, retry-once-then-alert) and `tasks/lessons.md` (pipeline-level corrections, e.g. API failure handling). This is what `subagent-start.js` injects into every `flyt-` agent regardless of which channel it's running for.
- **Per-channel** — `REFERENCES.md` (channel-specific outlier examples, what worked) and `tasks/lessons.md` (channel-specific corrections — a Channel A historical-accuracy fix has nothing to teach Channel B's countdown pacing, so these stay separate).

```
~/OpenClaw/NewChannels/
  CLAUDE.md                   ← pipeline-wide rules, under 100 lines, Boris starter template — written in Session 0
  tasks/
    lessons.md                ← pipeline-wide corrections — Boris hooks write here, you write here
  db/
    tracking.db              ← SQLite tracking database, see Section 00c
  ChannelA/
    STYLE_GUIDE.md            ← written in Session 0
    REFERENCES.md             ← Channel A outlier examples, what worked — populated as videos publish
    tasks/
      lessons.md              ← Channel A-specific corrections
    scripts/                  ← script/scene-JSON generator output, Session 1
    tmp/                      ← downloaded stills, hero clips, narration audio — cleared after upload
    manifests/                ← scene JSON per video
    outputs/                  ← rendered final videos, pre-upload
  ChannelB/
    STYLE_GUIDE.md
    REFERENCES.md
    tasks/
      lessons.md
    scripts/
    tmp/
    manifests/
    outputs/
  agents/
    flyt-orchestrator.js         ← Session 4 — shared across both channels, takes --channel flag
    flyt-script-generator.js     ← Session 1 — shared across both channels, takes --channel flag
    flyt-api-wrapper.js          ← Session 2 — shared, Gemini + BytePlus + VoxCPM2 calls
    flyt-validate.js             ← Session 2 — shared, ffprobe/frame/audio checks
    flyt-watchdog.js             ← post-Session 5 — shared, monitors both channels
    flyt-outlier-scanner.js      ← Session 6+ — shared, writes to both channels' bank rows
  logs/
    pipeline.log
    cost.log
    outlier-scan.log
```

Create this before Task 1 of Session 0:

```bash
mkdir -p ~/OpenClaw/NewChannels/tasks
mkdir -p ~/OpenClaw/NewChannels/db
mkdir -p ~/OpenClaw/NewChannels/ChannelA/{scripts,tmp,manifests,outputs,tasks}
mkdir -p ~/OpenClaw/NewChannels/ChannelB/{scripts,tmp,manifests,outputs,tasks}
mkdir -p ~/OpenClaw/NewChannels/agents
mkdir -p ~/OpenClaw/NewChannels/logs
touch ~/OpenClaw/NewChannels/tasks/lessons.md
touch ~/OpenClaw/NewChannels/ChannelA/tasks/lessons.md
touch ~/OpenClaw/NewChannels/ChannelA/REFERENCES.md
touch ~/OpenClaw/NewChannels/ChannelB/tasks/lessons.md
touch ~/OpenClaw/NewChannels/ChannelB/REFERENCES.md
```

**Boris hook wiring — flag for a separate OpenClaw-side session, not part of this build:** `subagent-start.js` currently reads lessons from `Brands/[Business]/tasks/lessons.md` paths only (per the Boris Hooks doc, Section 02). Since `NewChannels/` sits outside `Brands/` by design (Section 00, "no dependencies on other builds"), the hook needs explicit path additions for `~/OpenClaw/NewChannels/tasks/lessons.md` and the two per-channel `tasks/lessons.md` files before corrections here will actually compound the way they do for your other businesses. This is a one-time edit to a shared infrastructure file, not something Session 0 through 6 of this doc builds — track it as its own small task.

**CLAUDE.md starter content — write in Session 0, don't leave the file empty.** Use the Boris Formula starting template (Boris Hooks doc, Section 09):

```
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
```

---

## 00c. TRACKING DATABASE — SQLITE, NOT POSTGRES, NOT SUPABASE

**Decision:** local SQLite file at `~/OpenClaw/NewChannels/db/tracking.db`, with WAL mode enabled for concurrent write safety.

**Why not Supabase:** Supabase's value is auth, realtime subscriptions, storage buckets, and a public API layer. None of that applies here — this is internal agent-to-agent tracking, no external users, no media stored (confirmed: text/prompt/metadata only, no images or video in the database itself). Standing up Supabase, even self-hosted, brings infrastructure this pipeline was deliberately designed to avoid (see Section 00, Section 12 — "no shared cost, no shared infrastructure").

**Why not plain self-hosted Postgres either:** Postgres would make sense if this needed to merge into a shared cross-business knowledge layer. RHI's own doc plans exactly that via self-hosted Supabase/Postgres on the VPS — but that infrastructure doesn't exist yet, and per the doc's own priority order, New Channels launches *before* RHI Session 1. Depending on infrastructure that doesn't exist yet contradicts this build's explicit "no dependencies on other builds" design.

**Why SQLite handles the concurrent-write concern fine at this scale:** the actual write pattern is orchestrator writes per-video (6-10x/week combined), Watchdog writes hourly health/cost pings, outlier scanner writes weekly. With WAL mode enabled, SQLite comfortably handles that volume without lock contention. This isn't a high-throughput system.

**Migration path preserved:** the schema below is designed clean enough to port into Postgres later if a genuine cross-business knowledge layer ever gets built. No architecture is thrown away by starting with SQLite now.

### Schema

```sql
-- Per-video pipeline tracking
CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,              -- 'channel_a' | 'channel_b'
  entity TEXT,                        -- e.g. 'Vikings' (Channel A) or topic bank item (Channel B)
  situation TEXT,                     -- e.g. 'during war' (Channel A) or list theme (Channel B)
  title TEXT,
  status TEXT NOT NULL,                -- 'scripting' | 'qa_pending' | 'generating' | 'assembling' |
                                        -- 'pending_approval' | 'approved' | 'rejected' | 'published'
  script_path TEXT,
  manifest_path TEXT,
  cost_stills REAL DEFAULT 0,
  cost_hero REAL DEFAULT 0,
  cost_total REAL DEFAULT 0,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  published_at TEXT
);

-- Entity/situation combo tracking — prevents repeats, feeds the rotation axes in Section 01
CREATE TABLE entity_situation_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  entity TEXT NOT NULL,
  situation TEXT NOT NULL,
  used_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  UNIQUE(channel, entity, situation)
);

-- Outlier-scanning results — Section 05, populated manually now, by Agent-Reach at Session 6+
CREATE TABLE outlier_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,                        -- which channel this outlier could feed, or NULL if unclear
  source_video_url TEXT NOT NULL,
  source_channel_name TEXT,
  subs INTEGER,
  views INTEGER,
  days_since_upload INTEGER,
  title TEXT,
  thumbnail_style TEXT,
  format_match TEXT,                   -- 'existing_format' | 'new_format_candidate'
  status TEXT DEFAULT 'testing',       -- 'testing' | 'adopted' | 'passed'
  found_at TEXT DEFAULT (datetime('now'))
);

-- New format tangents that don't fit either existing channel — Section 05's
-- "new outlier -> new channel, not a pivot" rule. This is the landing place
-- for the "picking up new tangents" the YouTube scanner surfaces.
CREATE TABLE new_format_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_video_url TEXT NOT NULL,
  description TEXT,
  why_flagged TEXT,
  potential_entity_bank TEXT,
  status TEXT DEFAULT 'candidate',     -- 'candidate' | 'next_channel_planned' | 'passed'
  flagged_at TEXT DEFAULT (datetime('now'))
);

-- Weekly/per-video performance pull — Section 05b Analytics Feedback Loop
CREATE TABLE performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER REFERENCES videos(id),
  views INTEGER,
  watch_time_seconds INTEGER,
  ctr REAL,
  sub_conversion INTEGER,
  pulled_at TEXT DEFAULT (datetime('now'))
);

-- Watchdog cost + health log — Section 05a
CREATE TABLE watchdog_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,                     -- 'cost_check' | 'api_health' | 'schedule_check' | 'stuck_video'
  detail TEXT,
  severity TEXT DEFAULT 'info',        -- 'info' | 'warning' | 'alert'
  logged_at TEXT DEFAULT (datetime('now'))
);

-- QA/accuracy pass flags — Section 03 step 2. Previously had no defined
-- landing place; this is it.
CREATE TABLE qa_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER REFERENCES videos(id),
  channel TEXT NOT NULL,
  flagged_claim TEXT NOT NULL,         -- the specific unsupported/invented claim caught
  scene_reference TEXT,                -- which scene/timestamp in the script
  resolution TEXT DEFAULT 'pending',   -- 'pending' | 'rewritten' | 'confirmed_accurate' | 'video_rejected'
  flagged_at TEXT DEFAULT (datetime('now'))
);
```

**Who reads `qa_flags` and how it feeds prompt tuning:** at this volume, no automation is needed yet — a manual pass is enough. Recommended cadence: glance at `SELECT * FROM qa_flags WHERE resolution = 'pending'` once a week, same cadence as the outlier-scanning sheet (Section 05). If a particular claim type (e.g. specific-sounding numbers, invented quotes) shows up repeatedly across sessions, that pattern is exactly what Boris's `dream.js` is built to catch once the hook wiring above is in place — at that point `qa_flags` becomes another data source `dream.js` can read from, the same way it already reads git commits and STATE.md files for your other businesses. Not a Session 0-6 build item; just make sure the table exists so nothing is lost before that wiring happens.

### How the outlier scanner's "new tangents" actually flow through this

1. Outlier scanner (manual now, Agent-Reach at Session 6+) finds a video outperforming its channel size per the Section 05 validation checklist.
2. It writes a row to `outlier_candidates`. If the format clearly matches Channel A or B's existing structure, `format_match = 'existing_format'` — this becomes a candidate to expand the `entity_situation_bank` (new entity or new situation axis item), not a new channel.
3. If the format genuinely doesn't fit either channel's locked structure, it writes to `new_format_flags` instead — per Section 05's own rule, this is *never* folded into an existing channel. It sits as a candidate for the next channel launch.
4. Both tables get reviewed via Telegram or the Google Sheet (Section 05's tracking sheet stays as the human-readable view; SQLite is the machine-queryable source of truth underneath it).
5. `performance` data (Section 05b) feeds back against `entity_situation_bank.used_count` to show which combos are actually working — this is what the no-growth threshold decision (Section 06) gets measured against, with real numbers instead of gut feel.

---

## 00d. ENVIRONMENT VARIABLES — .env TEMPLATE

New Channels previously had no consolidated `.env` reference, unlike RHI (which has a full template in its own doc, Section 11). This is the equivalent. One shared `.env` file, not one per channel — per the "shared agents, one set" discipline in Section 03c, the only thing that genuinely needs per-channel separation is the YouTube OAuth credential set (Section 04, Section 04a). Everything else is one key, differentiated by the `channel` column at the data layer.

Add to `~/.openclaw/.env` alongside your existing keys:

```
# ─────────────────────────────────────────────
# NEW CHANNELS — SHARED KEYS
# ─────────────────────────────────────────────
GEMINI_API_KEY=                        # SET — Nano Banana 2 Lite stills
BYTEPLUS_API_KEY=                      # SET — Seedance 2.0 hero shots (2M free tokens on signup)
FLYT_BOT_TOKEN=                        # SET — see Section 13.6
FLYT_CHAT_ID=                          # SET — see Section 13.6
CLOUDINARY_CLOUD_NAME=                 # SET — dedicated new-channels/ folder, Section 02a
CLOUDINARY_API_KEY=                    # SET
CLOUDINARY_API_SECRET=                 # SET
NEWCHANNELS_DB_PATH=~/OpenClaw/NewChannels/db/tracking.db
NEWCHANNELS_MONTHLY_BUDGET=40.00       # Section 02 estimate — Watchdog (05a) alerts if spend trends above this

# ─────────────────────────────────────────────
# NEW CHANNELS — CHANNEL A ("Before Now") — SEPARATE GOOGLE ACCOUNT
# ─────────────────────────────────────────────
CHANNEL_A_YOUTUBE_CLIENT_ID=           # SET — after 04a verification submitted
CHANNEL_A_YOUTUBE_CLIENT_SECRET=       # SET
CHANNEL_A_YOUTUBE_REFRESH_TOKEN=       # SET — will expire every 7 days until app is verified, see 04a

# ─────────────────────────────────────────────
# NEW CHANNELS — CHANNEL B — SEPARATE GOOGLE ACCOUNT
# ─────────────────────────────────────────────
CHANNEL_B_YOUTUBE_CLIENT_ID=           # SET — after 04a verification submitted
CHANNEL_B_YOUTUBE_CLIENT_SECRET=       # SET
CHANNEL_B_YOUTUBE_REFRESH_TOKEN=       # SET — will expire every 7 days until app is verified, see 04a
```

`flyt-orchestrator.js --channel channel_a` reads the `CHANNEL_A_*` triplet; `--channel channel_b` reads the `CHANNEL_B_*` triplet. Same pattern as the `--channel` parameterization already established in Section 03c — one file, one set of shared keys, and only the credentials that Section 04 requires to be isolated are actually isolated.

---

## 01. THE TWO CHANNELS

### Channel A — Historical Curiosity
**Working name: "Before Now"** *(confirmed clear — no YouTube/search collisions as of July 2026)*

**Format:** "What Did [Entity] Do at [Situation]?" — proven template (Zenn's "What Did Ancient Humans Do at Night?" earned ~$25K on one video and spawned an entire niche copied by multiple independent channels within weeks).

**Structure:**
1. Hook question (0–3s)
2. Environment/context setup
3. Behavioral explanation
4. Hidden detail reveal
5. Emotional payoff

**Two rotation axes (swap one, keep the other, to avoid running out of content):**
- **Entity axis:** Ancient Humans → Romans → Aztecs → Vikings → Medieval Peasants → American Frontier Settlers → WWII Soldiers → (expand as needed)
- **Situation axis:** at night → when sick → during war → when it rained → when someone died → before a wedding → etc.

**Title formula:** `"What Did [Entity] Do [Situation]?"` — locked format per Adavia's rule: never deviate once something works.

**Consistency rule:** title/packaging locked unless the no-growth threshold below is triggered.

---

### Channel B — Countdown / Listicle
**Working name: TBD** *(user will finalize separately — "Ten Deep" confirmed clear as a fallback option)*

**Format:** Countdown/ranking content — "Top 10 Cities You'll Love," "25 Animals You Will Regret Coming Across." Bank-agnostic — works with any entity bank without needing a new pipeline.

**Structure:** Item #25 (or #10) → Item #1, escalating stakes/quality toward the top, one payoff beat per item.

**Title formula:** `[Number] + [Adjective] + [Topic] + [Enforcement]`
- Number: 10, 15, 17, 25 (specific numbers often outperform round ones)
- Adjective: emotional/quality signal — Incredible, Terrifying, Regretful, Forbidden, Deadliest
- Topic: the entity — Cities, Animals, Ancient Weapons, Prisons, etc.
- Enforcement: closing command implying consequence to the viewer — "You Will Regret," "You Must See," "That Actually Exist," "No One Talks About"

**Important tonal note:** avoid framing this channel around "wrong," "nope," "debunking," or correcting the viewer. This is a curiosity/ranking channel, not a myth-busting channel. Names and copy should stay in wonder/dread-curiosity territory, not corrective territory.

**Consistency rule:** same as Channel A — locked unless no-growth threshold triggers a full stop (see Section 06).

---

## 02. PRODUCTION STACK (LOW-COST, NO RUNPOD DEPENDENCY)

This deliberately does NOT use Higgsfield credits (shared with 2nd Exodus/Kadence) or RunPod (RHI/Bible Channel infrastructure). Fully separate, pay-per-use stack.

| Layer | Tool | Notes |
|---|---|---|
| Script generation | Claude Code / Groq | Format + entity + situation → scene JSON with timestamps |
| Stills | **Nano Banana 2 Lite** (Gemini API, `gemini-3.1-flash-lite-image`) | ~$0.034/image Standard, ~$0.017/image Batch. No usable free tier for API/automated calls — AI Studio's "free" quotas are browser-UI only, not scriptable. |
| Hero shots (1–2 per video) | **Seedance 2.0 via BytePlus/ModelArk API** | 2M free tokens on signup, then ~$0.022–0.05/sec pay-per-second. Do NOT use Dreamina — no API, visible + invisible watermark on all output regardless of plan. |
| Voice | **VoxCPM2 (Apache-2.0) via VoxCPMANE — local, Apple Neural Engine** | $0, no GPU rental needed. Runs on the Mac Mini's Neural Engine, a separate chip from what other agents compete over. See Section 13 for install. |
| Assembly | Remotion + **HyperFrames (via Open Design)** | Self-hosted, $0. **Critical: pass absolute local file paths via `--props`/inputProps, not `staticFile()`** — downloaded assets live outside the Remotion project directory. HyperFrames evaluated in Session 3 — see Section 09. |
| Outlier research | VidIQ (free tier) + TubeGen (optional) | See Section 05 |

**Estimated cost per video:** $0.30–$0.80 all-in (stills + 1–2 hero clips). Narration is now $0 (local TTS).
**Estimated monthly cost, both channels combined, 3–5 videos/week each:** roughly $20–40/month, likely lower once BytePlus's 2M free-token signup credit is absorbed.

---

## 02a. CLOUDINARY — VIDEO HOSTING FOR TELEGRAM DELIVERY

Telegram's bot API caps file uploads at 50MB. A finished video at any real resolution will exceed that. Rather than solving this from scratch, this pipeline reuses the same pattern already proven across Higgsfield, RHI, and Bible Channel: upload the rendered video to Cloudinary, then send Telegram a thumbnail preview plus the Cloudinary link.

**Isolation, not a shared account:** Higgsfield's Cloudinary is already documented as "separate from RHI Cloudinary" — same principle applies here. Create a dedicated `new-channels` folder (or sub-account, if you prefer full separation) so New Channels' asset costs and storage stay isolated from every other pipeline's Cloudinary usage, consistent with Section 12's "no shared cost" rule.

**Cost:** Cloudinary free tier covers 25GB storage and 25GB bandwidth. At 6-10 videos/week and typical compressed MP4 sizes, this pipeline stays well inside free tier for a long time — effectively $0.

---

## 03. PIPELINE ARCHITECTURE

Same agent-hierarchy shape as RHI/Bible Channel, lighter weight — no RunPod, no avatar animation, no Chatterbox GPU dependency.

1. **Script generation** (Claude Code/Groq) — format + entity bank + situation → scene JSON with per-scene timestamps, still vs. hero-shot designation, on-screen text.
2. **QA / accuracy pass (REQUIRED)** — before generation proceeds, script content gets checked for factual accuracy, especially Channel A's historical claims. LLM-generated historical specifics can drift into invented-but-confident "facts." Lightweight check step (self-critique pass, or a second model call specifically prompted to flag unsupported/invented claims) before the script is approved to move into asset generation. Log flagged items rather than silently correcting them, so patterns in what gets flagged can inform prompt tuning over time.
3. **Generation requests** — Claude Code/OpenCode calls:
   - Gemini API (NB2 Lite) for stills, per scene
   - BytePlus/ModelArk API (Seedance) for the 1–2 designated hero shots
   - **VoxCPM2 (local)** for narration audio per scene/script
4. **Async polling** — image/video APIs are job-based (submit → poll → complete). Orchestrator needs a polling loop, same pattern as Agent 4's SoulX validation in RHI. Local TTS calls return synchronously — no polling needed for narration.
5. **Download to local asset path** — e.g. `~/OpenClaw/[Channel]/tmp/scene_04_hero.mp4`
6. **Validation loop (REQUIRED)** — ffprobe check on each downloaded asset (duration/resolution match request), plus frame extraction at 4 positions to catch black/corrupt frames and audio level analysis to catch silence/clipping on narration output — **pattern taken directly from OpenMontage's review-gate design, implemented as plain code in `validate.py`, no framework dependency.** **Retry-once-then-alert pattern**, same discipline as RHI's SoulX retry logic — do not proceed on a failed/truncated generation. Build this in from session 1, not bolted on later.
7. **Assembly** — NB2 stills with Ken Burns/parallax motion for most scenes, downloaded hero clip dropped in at its designated timestamp, local VoxCPM2 narration synced to timestamps, transitions per the scene JSON's timing. (Remotion or HyperFrames — see Section 09.)
8. **Human approval gate (REQUIRED — see Section 03a)** — finished video is not published automatically. Sent for manual approve/reject via Telegram before any upload.
9. **Metadata/distribution step** — title (locked formula), description, tags, thumbnail. **Mark "altered or synthetic content" in YouTube's Content settings on every upload.** Confirm "Not Made for Kids" is set correctly at channel creation.
10. **Cleanup** — delete tmp files (hero clips, intermediate stills, intermediate audio) after confirmed upload, same as RHI Agent 7 pattern.

---

## 03a. HUMAN-IN-THE-LOOP APPROVAL (TELEGRAM) — FULL MECHANIC

No video publishes without manual approval. This section previously described the concept only — this is the actual implementation, matching the proven Cloudinary + Telegram pattern already running in Higgsfield, RHI, and Bible Channel.

**Bot:** FlytBot, dedicated to this pipeline (separate from BigJoe/Bible Bot/RHI's intake bots — same isolation principle as the account-per-channel rule in Section 04). Env vars: `FLYT_BOT_TOKEN`, `FLYT_CHAT_ID` in `~/.openclaw/.env`.

**The actual flow:**

1. `flyt-orchestrator.js` finishes assembly (Section 03, step 7) and has a rendered MP4 in `~/OpenClaw/NewChannels/[Channel]/outputs/`.
2. Orchestrator uploads the finished video to Cloudinary, into the dedicated `new-channels/[channel]/` folder (Section 02a). Gets back a public delivery URL and auto-generated thumbnail.
3. Orchestrator writes the video's `videos.status = 'pending_approval'` row in `tracking.db` (Section 00c).
4. Orchestrator sends a Telegram message via FlytBot to `FLYT_CHAT_ID` containing:
   - Thumbnail image (Cloudinary auto-generates this from the video)
   - Title, entity/situation, channel name
   - Cloudinary video link (tap to watch full video before deciding)
   - Total cost for this video (stills + hero shot spend from Section 02)
5. Banc replies **approve** or **reject [optional reason]** in the same Telegram thread.
6. **Approve** → orchestrator sets `videos.status = 'approved'`, proceeds to the metadata/distribution step (Section 03, step 9): writes title, description, tags, marks "altered or synthetic content," uploads to YouTube via the channel's dedicated Google account.
7. **Reject** → orchestrator sets `videos.status = 'rejected'`, writes `reject_reason` to the row, does not upload. Source assets in `tmp/` are kept, not deleted, until confirmed not needed (same as v1.0's original rule) — this preserves the ability to review what went wrong.
8. This gate stays in place indefinitely, same as the original design — it's the safety net for the QA/accuracy pass (Section 03, step 2) and for catching anything the automated validation steps (Section 03, step 6) miss.

**Verification command, same pattern as Higgsfield Delivery:**
```bash
curl localhost:6420/health  → { status, agent, pendingApproval, lastDelivery }
```
*(Port 6420 suggested — check Section 11-equivalent port registry before final assignment; New Channels doesn't currently have a reserved port block, first available in the 6420s range recommended to avoid collision with existing OpenClaw agents.)*

---

## 03b. GIT DISCIPLINE

Standard practice for all pipeline code (script generator, API wrappers, orchestrator, QA-pass logic, validate.py): commit at session end, same as every other OpenClaw project. Plan mode before non-trivial changes, one task per session, verify before marking done.

---

## 03c. SHARED AGENTS — ONE SET SERVES BOTH CHANNELS

All 6 `flyt-` agents are shared across Channel A and Channel B — not duplicated per channel. This is confirmed, not assumed.

**Why this works:** both channels run the identical 5-phase pipeline described in Section 03 — script generation, QA pass, generation requests, validation, assembly, approval, distribution. The only things that differ between channels are data, not logic:

- Entity/situation bank content (Section 01) — filtered by `channel` column in `entity_situation_bank`
- Visual style (Section 08's STYLE_GUIDE.md, one per channel)
- Title formula (Section 01 — different string template per channel, but same substitution logic)
- Thumbnail formula (Section 07)

**How agents take the channel as a parameter, not a fork:**

```bash
node flyt-script-generator.js --channel channel_a
node flyt-script-generator.js --channel channel_b
node flyt-orchestrator.js --channel channel_a --video-id 42
```

Each agent reads `~/OpenClaw/NewChannels/[channel]/STYLE_GUIDE.md` and queries `tracking.db` filtered by the `channel` column at runtime. This matches the pattern your Higgsfield pipeline already uses to serve both 2ndexodus and Kadence Naturals from one shared agent set instead of maintaining duplicate code per brand.

**Net result:** 6 files total, not 12. Adding a third channel later (per Section 05's "new outlier → new channel" rule) means adding a new `ChannelC/` folder, a new STYLE_GUIDE.md, and new bank rows — not writing 6 new agent files.

---

## 04. ACCOUNT STRUCTURE

- **Separate Google account per channel** — isolates strike/demonetization risk between Channel A, Channel B, and the rest of the Banc portfolio (RHI, Bible Channel, Archouse).
- Not Made for Kids: confirm at channel creation for both.
- Synthetic content disclosure: standard step in the distribution agent's metadata-writing routine, every upload.

---

## 04a. OAUTH VERIFICATION — DO THIS NOW, NOT AT SESSION 4

**The problem:** a Google Cloud OAuth app left in "Testing" publishing status issues refresh tokens that expire after 7 days. Since this pipeline auto-uploads unattended (Section 03, step 9), an unverified app means the very first automated upload after week one silently fails with an expired-token error — everything else in the pipeline (script, stills, hero shots, narration, assembly, approval) will have worked correctly, only the last step breaks, and it breaks quietly.

**The fix, and why it needs to start now:** Google's OAuth consent screen verification review is not instant — it can take real time, sometimes longer if the reviewer requests changes. Since Session 4 (orchestrator + first end-to-end test, per Section 10) is only a few sessions away, starting verification in parallel with Session 0-3 build work means it has a chance to clear before you actually need a working, non-expiring upload path.

**Action, per Google account (both Channel A and Channel B):**
1. In Google Cloud Console, create the project and enable the YouTube Data API v3.
2. Configure the OAuth consent screen with the `youtube.upload` scope.
3. Submit for verification/publish the app out of Testing status — do this immediately after account creation, not after the pipeline is built.
4. Track status in `NewChannels/tasks/lessons.md` so a future session doesn't waste time debugging what is actually a pending verification, not a bug.

At your posting cadence (6-10 videos/week combined, per Section 02a), you're also well under the default YouTube Data API quota (10,000 units/day, ~6 uploads/day per project) — quota itself isn't expected to be a blocker, only the refresh-token expiry is.

---

## 05. OUTLIER-SCANNING ENGINE

**Purpose:** continuously surface new formats/templates worth stealing — the actual research engine behind Adavia's method, not brainstorming.

**Definition of an outlier:** a video massively outperforming what its channel's subscriber count would predict (e.g., 5K-subscriber channel pulling 500K+ views on one video).

**Validation checklist (from Adavia, not all required but more = stronger signal):**
- Under 100K subscribers
- Posted within the last 1–6 months
- 800K+ views (his "viral" threshold)
- Channel shows growth trend, not a dead one-hit channel
- Format is reproducible with your stack

**Tools:**
- **VidIQ** (free tier to start, $7.50/mo if more depth needed) — primary outlier/competitor tracking
- **TubeGen** (optional, $29–99/mo) — niche/format discovery; skip initially since it lacks true outlier detection per independent reviews and you're fluent enough in AI creation to not need its scripting/thumbnail suite

**Workflow:**
- Scan 1–2x/week
- Log per candidate: channel subs, video views, days since upload, title, thumbnail style, format match (existing format or "new format candidate")
- Track in a Google Sheet: date found | channel | video | subs | views | ratio | title formula | thumbnail formula | entity/subject | status (testing/adopted/passed)

**Agentic automation path — CONFIRMED for Session 6+, not before:** Agent-Reach (`Panniantong/agent-reach`) gives Claude Code direct YouTube transcript and trend access with zero API fees, and can cover part of this scanning workflow once the core pipeline is proven and publishing. Do not install before Session 6 — see Section 00a for rationale. Same Watchdog/Agent-9-style architecture already used in RHI, applied to research instead of pipeline health.

---

## 05a. WATCHDOG

Same responsibility shape as RHI's Agent 9, applied to this pipeline:

- **Schedule guardian** — confirms the pipeline actually fired when it was supposed to (e.g., scheduled script generation didn't silently fail to trigger). Alert to Telegram if no activity detected within expected window.
- **Pipeline timeout monitor** — if a video enters the pipeline and doesn't reach the approval-gate step within a defined time limit, alert rather than let it hang silently.
- **Stuck-video detection** — flags any video sitting at the Telegram approval gate unactioned past a threshold (e.g., 24–48 hours), as a nudge rather than a failure state.
- **API health checks** — periodic ping/test call to Gemini and BytePlus endpoints (and a local health check on the VoxCPM2 process) to catch outages or auth failures before they silently break a scheduled run.
- **Cost tracking** — logs per-video generation cost (stills + hero shots; narration is $0) against the monthly estimate in Section 02, alerts if spend trends meaningfully above expected.

Build this after the core pipeline is working end-to-end (post Session 4/5) rather than day one — same sequencing RHI followed (Watchdog was Session 9/10 territory, not Session 1).

---

## 05b. ANALYTICS FEEDBACK LOOP

Closes the loop between the outlier-scanning research (Section 05) and actual channel performance, so format/entity decisions are validated against real results, not just external signal.

- Pull YouTube Studio performance data per published video: views, watch time/retention, CTR, subscriber conversion.
- Feed this back into the same tracking sheet used for outlier scanning — same schema (title formula, entity, thumbnail style) so your own videos can be compared directly against the outliers that inspired them.
- Use this to inform the **no-growth threshold** decision (Section 06) with real data rather than gut feel — e.g., which entity/situation combinations on Channel A are actually outperforming, which countdown topics on Channel B are underperforming.
- Longer-term: this data set becomes the input for deciding when to launch the *next* channel (per the "new outlier → new channel" rule in Section 05) — patterns in what performs well here inform which new formats are worth chasing.
- Build timing: not needed until videos are actually publishing (post-launch), but worth scaffolding the sheet schema now so it's ready to receive data from day one of publishing rather than retrofitted later.

---

- **Packaging (title/thumbnail formula) stays locked per channel unless the no-growth threshold is hit.** Define the threshold in concrete numbers before launch (e.g., X videos posted with sub-Y average views, or view count flat/declining across Z consecutive uploads) so the decision is mechanical, not emotional.
- **New format/outlier discovered → new channel, not a pivot.** Each channel keeps one locked format + one entity bank for its lifetime. When scanning surfaces a strong outlier that doesn't fit an existing channel, it becomes a candidate for the *next* channel launch rather than being folded in.
- **Authenticity requirement:** each video needs genuine script variation, not template find-and-replace — YouTube's mass-produced/repetitive content policy specifically targets templated, high-volume AI content. Same format, same title formula, but unique scripting per entity/situation combination, every time.

---

## 06. NO-GROWTH THRESHOLD

*(Placeholder retained from v1.0 — concrete numbers to be locked before launch per Section 05's guidance.)*

---

## 07. THUMBNAIL FORMULAS

**Channel A (Historical):** Adavia's "3-subject cartoon style" — center subject unfamiliar/curiosity-inducing, flanked by 1–2 supporting figures for context. Emotional read: intrigue, not shock.

**Channel B (Countdown):** Single dominant subject, high-contrast, dramatic/exaggerated. Optional number badge overlay to reinforce the countdown promise visually.

Both generated via NB2, overlay/text via Remotion, HyperFrames, or Canva. YouTube's native A/B thumbnail testing (free, in Studio) worth turning on once posting regularly — later-stage optimization, not launch-blocking.

---

## 08. PRE-BUILD PREP — TEMPLATE SKETCH

Before Session 1, define a visual layout spec per channel — a simple sketch/diagram plus a written description covering:
- Where stills/hero shots sit in frame (full-screen, corner, split)
- Caption placement and styling (position, font, size)
- Color theme (locked per channel, same discipline as title/thumbnail consistency)
- Transition style between scenes
- Any persistent on-screen elements (number badges for Channel B, timestamp/era tags for Channel A)

This becomes the visual equivalent of the STYLE_GUIDE.md pattern already used for Bible Channel — feed it to Claude Code once, alongside the editing-flow description (script → beats → per-beat scene → assembly → captions → render), so every session and every generated video follows the same spec without re-explaining it. Do this per channel since Channel A and Channel B will likely want different visual identities.

---

## 09. ASSEMBLY LAYER — HYPERFRAMES (VIA OPEN DESIGN) VS. REMOTION

**Decision for v2.0: evaluate HyperFrames through Open Design rather than as a standalone install.**

Open Design (`nexu-io/open-design`) is already being installed for other Banc businesses and ships HyperFrames built in. Rather than a second, separate `npx skills add heygen-com/hyperframes` install, test the assembly workflow directly inside Open Design during Session 3. This avoids running two overlapping design/motion tools side by side.

**HyperFrames** (open-source, Apache 2.0, built by HeyGen — `github.com/heygen-com/hyperframes`) remains worth understanding on its own merits:

- HTML/CSS/JS-based composition instead of React — LLMs write HTML fluently, which may make agent-driven scene assembly more reliable than Remotion's React component model
- Free, no per-render fees, deterministic rendering (same input → same output, useful for CI/regression-style testing of the pipeline)
- Ships built-in skills relevant to this exact use case: beat planning, caption authoring, TTS voiceover integration, motion graphics, slideshow composition — several of these may cover work you'd otherwise hand-build in Remotion
- Non-interactive CLI, built for scripted/agentic workflows specifically — matches the "minimal human interaction" goal better than a manually-driven Remotion setup

**Recommendation:** trial HyperFrames via Open Design during Session 3 (assembly template build) alongside/instead of Remotion. If its beat/caption/TTS skills reduce custom code needed for the scene-JSON → final-render step, it may be the better default for these two channels specifically, while Remotion stays the right choice for anything already built around it (e.g. Bible Channel's Ken Burns/parallax pipeline, which stays as-is).

---

## 10. BUILD SESSION PLAN

Following existing session discipline (one task per session, plan before build):

| Session | Task | Model |
|---|---|---|
| **0** | **Create folder structure (Section 00b), including shared + per-channel `CLAUDE.md`/`REFERENCES.md`/`tasks/lessons.md`. Write starter `CLAUDE.md` content using the Boris Formula template (Section 00b). Init SQLite tracking database including `qa_flags` (Section 00c, Section 13.5). Add `.env` entries (Section 00d). Install workflows-engineering skill (see Section 13). Template sketch + visual spec per channel (see Section 08).** | Opus 4.8 — fully mechanical, spec is explicit |
| 1 | Script/scene-JSON generator — format + entity bank + situation → scene JSON with timestamps | Opus 4.8 — scoped feature build |
| 2 | NB2 stills + Seedance API wrapper — generation, polling, download, ffprobe validation, retry-once-then-alert. **Wire in VoxCPM2 local narration call in this session as well.** | Opus 4.8 — multiple integrations, each well-defined |
| 3 | Assembly template — test HyperFrames via Open Design vs. Remotion (Section 09), build compositing + transitions from timestamps | **Fable 5** — genuinely ambiguous, "which tool fits better" is investigation territory |
| 4 | Orchestrator tying it together + first end-to-end test video (Channel A) | **Fable 5** — first full pipeline run is where non-obvious cross-agent bugs surface |
| 5 | Channel B config — reuse pipeline, new entity bank/format, first test video | Opus 4.8 — reusing a proven pattern |
| 6+ | Outlier-scanning sheet + manual scan cadence; **evaluate Agent-Reach for automation at this point, not earlier (see Section 00a).** | Opus 4.8, unless it turns into deep debugging |

**Model routing rule:** this is a starting default per session, not a rule to push through no matter what. If a Session-0/1/2/5/6-type task unexpectedly goes sideways and starts spanning multiple debugging attempts, that's the cue to switch to Fable 5 mid-session (`/model fable`) rather than pre-committing to Opus for the whole thing. See the `## Model Routing` block in the Section 00b `CLAUDE.md` starter content — this is written into the pipeline's own rules file, not just this doc, so it persists across sessions and fresh Claude Code instances.

**Estimated timeline:** first working video within ~4 sessions (roughly a week at daily cadence). Both channels producing real videos within **2 weeks**.

---

## 11. IMMEDIATE ACTION ITEMS

- [ ] **Create folder structure (Section 00b) — do this before anything else**
- [ ] **Initialize SQLite tracking database including `qa_flags` (Section 00c, Section 13.5)**
- [ ] **Start Google OAuth consent screen verification for both channel accounts NOW, in parallel with build sessions — do not wait until Session 4 (Section 04a)**
- [ ] **Flag `subagent-start.js` for a path update so it reads `NewChannels/tasks/lessons.md` and both per-channel lessons files — separate small task, not part of Sessions 0-6 (Section 00b)**
- [ ] Finalize Channel B name (Channel A locked: "Before Now")
- [ ] Build template sketch + visual spec for both channels (Section 08)
- [ ] Create 2 separate Google accounts (one per channel)
- [ ] Set up Gemini API key (Google AI Studio) for NB2 Lite
- [ ] Set up BytePlus/ModelArk account for Seedance API (claim 2M free tokens on signup)
- [ ] **Install workflows-engineering skill (Section 13)**
- [ ] **Install VoxCPM2 + test Voice Design mode (Section 13)**
- [ ] **Install/confirm Open Design has HyperFrames available (Section 13)**
- [ ] Build Google Sheet for outlier tracking (schema shared with analytics feedback loop, Section 05b)
- [ ] Set concrete no-growth threshold numbers for both channels
- [ ] Set up Telegram approval-gate bot/channel for this pipeline (Section 03a)
- [ ] Session 1: build script/scene-JSON generator
- [ ] Set "Not Made for Kids" + synthetic content disclosure as standard steps in distribution checklist
- [ ] Channel assets (banner, icon, description) — deferred until pipeline is complete, not a launch blocker

---

## 12. KEY CONSTRAINTS TO REMEMBER

- **No Higgsfield credits** for these channels — separate API stack (Gemini + BytePlus), keeps 2nd Exodus/Kadence's shared pool untouched.
- **No Dreamina** — no API, watermarked (visible + invisible), not automatable.
- **No RunPod** — these channels don't need GPU-hosted avatar animation; that's RHI/Bible Channel territory only.
- **No Chatterbox / cloud TTS** — narration is local via VoxCPM2, zero marginal cost, zero GPU rental.
- **No OpenMontage as a running dependency** — its validation pattern is borrowed as plain code, not run as a framework alongside this pipeline's own orchestrator.
- **No ClinePass or model-switching mid-build** — one model (Claude Code) for the full 6-session build, to preserve schema/architecture continuity across sessions.
- **No Agent-Reach before Session 6** — outlier-scanning automation is a post-launch upgrade, not a Session 1 dependency.
- **Validation/retry loop is mandatory**, not optional, from the first build session.
- **Authenticity over templating** — script variation is a policy requirement, not just a quality preference.
- **Separate accounts per channel** — risk isolation, non-negotiable.

---

## 13. TOOL INSTALL INSTRUCTIONS

None of the tools below are installed yet. Install in this order.

### 13.1 — workflows-engineering skill (install first, before Session 0)

Reference skill for Claude Code — teaches it how to structure Dynamic Workflows (trigger, phases, workers, checks, stop rule, artifacts) before you start designing this pipeline's orchestrator. Zero runtime footprint, no dependencies.

```bash
mkdir -p ~/.claude/skills/workflows-engineering
curl -o ~/.claude/skills/workflows-engineering/SKILL.md \
  https://raw.githubusercontent.com/grandamenium/workflows-engineering/main/SKILL.md
curl -o ~/.claude/skills/workflows-engineering/metadata.json \
  https://raw.githubusercontent.com/grandamenium/workflows-engineering/main/metadata.json
```

Verify:
```bash
ls ~/.claude/skills/workflows-engineering/
```

---

### 13.2 — VoxCPM2 + VoxCPMANE (local TTS — install during Session 1 prep)

Apache-2.0 licensed, 2B parameter tokenizer-free TTS. Run on Mac Mini's Apple Neural Engine via the community VoxCPMANE backend to avoid competing with other agents for CPU/GPU.

```bash
# Base install
pip3.11 install voxcpm --break-system-packages

# VoxCPMANE backend for Apple Neural Engine
pip3.11 install voxcpm-ane --break-system-packages
```

**Test using Voice Design mode — no reference audio file required.** VoxCPM2 can synthesize a new voice from a natural-language description alone, which is the right starting point for New Channels since no channel voice has been sourced or locked yet:

```bash
python3.11 -m voxcpm.test \
  --mode design \
  --description "a calm, authoritative male narrator, slight gravitas, measured pace" \
  --text "Testing narration output for the Before Now channel." \
  --output ~/OpenClaw/NewChannels/tmp/voxcpm-test.wav
```

If VoxCPMANE proves unreliable on the Neural Engine, fall back to CPU mode:
```bash
python3.11 -m voxcpm.test \
  --mode design \
  --description "a calm, authoritative male narrator, slight gravitas, measured pace" \
  --text "Testing narration output for the Before Now channel." \
  --device cpu \
  --output ~/OpenClaw/NewChannels/tmp/voxcpm-test-cpu.wav
```

Listen to both outputs (AirDrop to MacBook if needed) before locking in a device mode for the pipeline.

**Note on reference-clip cloning:** VoxCPM2 also supports cloning from a short reference WAV once a channel voice is actually sourced and locked in (Controllable Cloning or Ultimate Cloning modes — see the model's usage docs for `prompt_wav_path`/`prompt_text` parameters). This is a later refinement, not a Session 1/2 blocker. Do not point this pipeline at `~/OpenClaw/BibleChannel/Characters/` for a reference file — that folder is empty and unrelated to New Channels; source and store any New Channels reference clips under `~/OpenClaw/NewChannels/[Channel]/` instead, keeping this build fully isolated per Section 00's design.

---

### 13.3 — Open Design (assembly layer — HyperFrames included — install during Session 3 prep)

Desktop app, native Apple Silicon build, no compile required for the standard path.

```bash
# Preferred — download desktop app directly
open https://open-design.ai
# Download macOS Apple Silicon DMG, install, launch
```

If running from source instead:
```bash
git clone https://github.com/nexu-io/open-design.git
cd open-design
corepack enable
pnpm install
pnpm tools-dev run web
```

Verify HyperFrames is available inside the app before starting Session 3's assembly template work — check the skills/tools panel for HyperFrames-related composition options.

---

### 13.5 — SQLite tracking database (init during Session 0, after folder structure)

No install needed — SQLite ships with Python 3.11 (`sqlite3` module) and is already present on both Mac Mini and VPS. This step just initializes the database file and schema.

```bash
python3.11 << 'EOF'
import sqlite3
import os

db_path = os.path.expanduser("~/OpenClaw/NewChannels/db/tracking.db")
conn = sqlite3.connect(db_path)
conn.execute("PRAGMA journal_mode=WAL;")

conn.executescript("""
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  entity TEXT,
  situation TEXT,
  title TEXT,
  status TEXT NOT NULL,
  script_path TEXT,
  manifest_path TEXT,
  cost_stills REAL DEFAULT 0,
  cost_hero REAL DEFAULT 0,
  cost_total REAL DEFAULT 0,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS entity_situation_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  entity TEXT NOT NULL,
  situation TEXT NOT NULL,
  used_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  UNIQUE(channel, entity, situation)
);

CREATE TABLE IF NOT EXISTS outlier_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  source_video_url TEXT NOT NULL,
  source_channel_name TEXT,
  subs INTEGER,
  views INTEGER,
  days_since_upload INTEGER,
  title TEXT,
  thumbnail_style TEXT,
  format_match TEXT,
  status TEXT DEFAULT 'testing',
  found_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS new_format_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_video_url TEXT NOT NULL,
  description TEXT,
  why_flagged TEXT,
  potential_entity_bank TEXT,
  status TEXT DEFAULT 'candidate',
  flagged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER REFERENCES videos(id),
  views INTEGER,
  watch_time_seconds INTEGER,
  ctr REAL,
  sub_conversion INTEGER,
  pulled_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchdog_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  detail TEXT,
  severity TEXT DEFAULT 'info',
  logged_at TEXT DEFAULT (datetime('now'))
);
""")

conn.commit()
conn.close()
print(f"Tracking database initialized at {db_path}")
EOF
```

Verify:
```bash
sqlite3 ~/OpenClaw/NewChannels/db/tracking.db ".tables"
```

Should output: `entity_situation_bank  new_format_flags  outlier_candidates  performance  videos  watchdog_log`

---

### 13.6 — FlytBot (Telegram approval bot — set up during Session 4 prep)

New bot, dedicated to New Channels only — same isolation principle as BigJoe (Higgsfield) and the Bible Channel bot.

1. Message @BotFather on Telegram
2. `/newbot` → name it `FlytBot` (or your preferred display name) → get the bot token
3. Message your new bot once (any text) so it has a chat to reply to
4. Get your chat ID:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```
Look for `"chat":{"id":` in the response — that's your `FLYT_CHAT_ID`.

5. Add to `~/.openclaw/.env`:
```
FLYT_BOT_TOKEN="your-token-here"
FLYT_CHAT_ID="your-chat-id-here"
```

6. Verify:
```bash
curl -X POST "https://api.telegram.org/bot${FLYT_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${FLYT_CHAT_ID}" \
  -d "text=FlytBot online — New Channels pipeline connected."
```

You should receive the test message in Telegram before proceeding to Session 4.

---

### 13.7 — Not installed in this build (reference only)

The following were evaluated for this specific pipeline and are **not** part of the v2.0 install list. Do not install for New Channels — they're either filed for other Banc projects or gated to a later session per Section 00a:

- **OpenMontage** — pattern borrowed into `validate.py`, not run as a dependency here
- **ClinePass** — filed for post-launch maintenance work only
- **Agent-Reach** — gated to Session 6+, install then per Section 05
- **Artlist Max/Creator, Palmier Pro, GBrain** — not applicable to this pipeline

---

*New Channels Master Build v2.5 — Michael Bryant II — July 2026*
*This is the current top priority. RHI Agent 4 rewrite, Walking in the Way visual-agent.js fix, and KeyLux remain active but secondary until these two channels are producing revenue.*

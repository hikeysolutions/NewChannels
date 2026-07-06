# Channel C ("FailNation"). Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md

## Inheritance (READ FIRST)
FailNation runs on Channel A's shared infrastructure only: the flyt- agent set, the LLM/image
provider registries, the QA gate, the assembly pipeline, and the Telegram approval flow (Master
Doc Section 03c). It inherits NONE of Channel A's creative tuning. Its persona, prompt content,
length, thumbnail treatment, and provider choices are its own. Do not copy Channel A's persona,
Story Ladder/Kallaway prompt content, or length target into this channel.

## Format
30 to 60 second comedic "fail" shorts. Short-form, fast, one gag per clip, built to resolve on a
clean comedic beat. Slapstick, not real harm.

## Content Scope (LOCKED)
- Subjects: young adults and animals ONLY. No depiction of minors, ever (Part 4, locked by
  avoidance, not by the permissive ToS reading).
- No real, identifiable people (Part 4).
- No existing/copyrighted IP or recognizable derivatives (Part 4).
- Every fail resolves safely and unharmed. Slapstick physics, never real injury or genuine harm.
  This is a hard content rule, not a stylistic note.

## Active Providers
- Storyboard stills: GPT Image 2. Confirmed strong for this format, photorealistic and stylized
  both tested, with consistent character and style held across sequential prompts. Identity, build,
  and garment type hold reliably even at the low quality tier (Part 5). The one caveat: do not rely
  on the low tier for exact color continuity of any single element (wardrobe or prop) if a gag
  depends on that exact color staying identical across shots. If a shot needs an exact recurring
  color, generate it with maximal color specificity or check a higher tier before shipping it.
  Pin the model and quality in ChannelC/config.json, resolved by lib/image_providers.py.
- Video generation: UNDECIDED. This is the one real open item blocking a first render. Pixverse C1
  standard tier researched as compliant and reasonably priced. Now that scope is confirmed
  adults-only, cheaper Spicy/uncensored tiers are also worth comparing on cost and quality. Decide
  before the first build. See the hard rule below before considering any uncensored tier.
- LLM: shared config-ordered chain (config/llm-models.json). Per-channel prompt content is this
  channel's own, not inherited.

## Uncensored / Spicy Tier (HARD RULE)
Any Spicy or uncensored model tier requires an explicit 18+ confirmation on EVERY API call, full
stop, regardless of how the content is framed (verified against Atlas Cloud's own model docs).
Never route through an uncensored tier to work around another tier's restriction. An uncensored
tier is never a workaround for a content-policy question, it only moves enforcement from
generation-time to upload-time (Part 4). Resolve policy risk by not generating the content.

## Length Target (TO BE SET)
30 to 60 second runtime. Set the target explicitly in this channel's prompt configuration before
the first run. Not inherited from Channel A.

## QA Gate (shared mechanism)
Same lib/qa.js gate. `voice_consistency` and `gap_logic` blocking; `factual_accuracy` and pacing
advisory. Voice rubric to be defined for FailNation's own narration/comedic style before first run
(persona spec is this channel's, not Channel A's).

## Compliance (inherited + scope-specific)
The universal hard rules apply: no real-person likeness, no minors (both already locked). This
channel's locked scope (adults and animals only, safe resolution, no real people, no existing IP)
is an application of Part 4, not a new independent policy gate.

## Known Open Items
- Video-generation model not chosen (Pixverse C1 standard vs cheaper Spicy/uncensored tiers on cost
  and quality). Real blocker to a first render.
- Persona / narration voice spec not yet written for this channel.
- Length target and active image model+quality not yet pinned in ChannelC/config.json.
- Color theme still TBD in STYLE_GUIDE.md (Banc to define separately).
- No entity/gag seed data (separate decision, out of scope here).

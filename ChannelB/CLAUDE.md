# Channel B (countdown/listicle, name TBD). Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md

## Inheritance (READ FIRST)
Channel B runs on Channel A's shared infrastructure only: the flyt- agent set, the LLM/image
provider registries, the QA gate, the assembly pipeline, and the Telegram approval flow (Master
Doc Section 03c, "6 shared agent files, not 12"). It inherits NONE of Channel A's creative tuning.
Its persona, prompt content, length target, thumbnail treatment, and active provider choice are
all its own. Do not copy Channel A's "Reluctant Witness" persona, Story Ladder/Kallaway prompt
content, or length target into this channel.

## Naming (TBD, does NOT block build)
No locked name yet. "Ten Deep" rejected (ties the name to a fixed count). "Critical Path" checked
and unavailable. Direction: a durable media-company/show label decoupled from any specific count
or mechanic, so the format can evolve without a rename (Section 11 addendum). Full naming exercise
is its own task. Nothing else in this file waits on it.

## Persona (LOCKED)
"The Survivor". Full spec in Master Doc Section 06, frozen after the v2.7 revision. A narrator who
recognizes escalation thresholds from repeated exposure to how systems go wrong, NOT from personal
history or lived experience. Default lens: "at what point does this fundamentally change," never
"what is this." Short, punchy, rapid-fire default rhythm with direct address; a longer line is
allowed only to land an escalation beat. Emotional core is urgent camaraderie, an adrenaline
debrief, wired not traumatized, never doom. Identity stays implicit, never stated. Injected first
in the script-generator system prompt, ahead of format rules. Read at runtime from the frozen
Section 06 copy, not restated in the prompt by hand.

## Title Formula (LOCKED)
`[Number] + [Adjective] + [Topic] + [Enforcement closing command]`
e.g. "17 Ancient Weapons You Won't Believe Existed".
- Number: specific numbers (17, 25) tend to outperform round ones (10, 20).
- Adjective: an emotional/quality signal (Incredible, Terrifying, Forbidden, Deadliest).
- Topic: the entity, pulled from the entity bank.
- Enforcement: a closing command implying consequence ("You Won't Believe Existed", "No One Talks
  About", "You Must See").
Never deviate once it works (Adavia's rule). Rotation is bank-driven: swap the topic, keep the
formula. Bank-agnostic by design, so it works against any entity bank filtered to this channel.

## Tonal Guard (LOCKED)
Curiosity/ranking channel, NOT myth-busting. Stay in wonder / dread-curiosity territory. Never
frame anything as "wrong", "nope", "debunking", or correcting the viewer. This is a hard tonal
rule, not a preference, and it holds in titles, hooks, and every level's payoff line.

## Format
Countdown/ranking. An ascending countdown from item #25 (or #10) down to #1, stakes and quality
escalating toward the top, exactly one payoff beat per item. Each item maps to a manifest block
carrying `level_badge`, `gap_type`, and `gap_state` (Section 00c). Blocks are sequential: the
ascending badge requires order, so they cannot be reordered freely. A block may open a new tension
before the previous one resolves, but the countdown sequence itself stays fixed.

## Active Providers (TO BE SET before first build)
Registry-driven, same mechanism as Channel A, but the actual choices are NOT inherited and are not
yet locked for Channel B. Set them explicitly in ChannelB/config.json before the first real render:
- Image: choose and pin a model in ChannelB/config.json (`image_model`), resolved by
  lib/image_providers.py. Do not assume Channel A's Atlas GPT Image 2 choice carries over.
- LLM: the config-ordered chain in config/llm-models.json is shared; the per-channel prompt content
  is not. Confirm the chain is appropriate for this channel before the first run.
These are open items, not blockers to the rest of the build planning.

## Length Target (TO BE SET)
Not inherited from Channel A. Countdown runtime scales with item count, so the target lives in this
channel's own prompt configuration, set before the first real run. Do not reuse Channel A's
650-750 word block.

## QA Gate (shared mechanism, same categories)
Same lib/qa.js gate as Channel A. `gap_logic` and `voice_consistency` are the blocking categories;
`factual_accuracy` and pacing are advisory. Voice Consistency scores against the Section 06 rubric
for "The Survivor" (not the "Reluctant Witness" rubric), rejects at <= 5/10. Additional Channel B
constraint: no two consecutive blocks may repeat the same `gap_type` (Section 00c).

## Compliance (inherited, non-negotiable)
The only hard, non-negotiable content rules are: no real-person likeness, and no depiction of
minors (Section 04/Part 4). Both already locked, both already followed. This channel adds NO extra
policy gate of its own.

## Known Open Items
- Name not locked (does not block build).
- Active image provider and length target not yet set in ChannelB/config.json.
- Zero Channel B rows seeded in entity_situation_bank (separate decision, out of scope here).
- Color theme and caption typeface still TBD in STYLE_GUIDE.md, must be locked before first render.

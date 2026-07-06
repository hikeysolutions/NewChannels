# Arc Bureau. Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md
# NAMING: descriptive show name, matching ChannelA-E. Folder is ArcBureau/.
# CANONICAL SPEC: ArcBureau/ARC_BUREAU_SPEC.md is the locked source of truth; this file summarizes it.

## Inheritance (READ FIRST)
Arc Bureau runs on Channel A's shared infrastructure only: the flyt- agent set, the LLM/image
provider registries, the QA gate, the assembly pipeline, and the Telegram approval flow (Section
03c). It inherits NONE of Channel A's creative tuning. Persona ("The Analyst"), prompt content,
length target, and provider choices are its own. Never copy Channel A's "Reluctant Witness"
persona, Story Ladder/Kallaway prompt content, or length target into this channel.

## What Arc Bureau Is
A premium narrative simulation channel. Not stories: case files of human identity transformation
under changing environments. Every script answers one question: what does a human become when their
environment changes faster than their identity can update? Second-person ("You") default.

## Persona (LOCKED — "The Analyst")
Injected first in the script-generator system prompt, ahead of format rules. Identity stays
implicit, never stated. Frozen machine-readable copy goes in agents/lib/personas.js when build
starts. Full text in ARC_BUREAU_SPEC.md (NARRATOR STYLE).
- **Identity:** an institutional analyst documenting behavioral adaptation under pressure, speaking
  with calm inevitability because the pattern is familiar.
- **Decision Framework / Default Lens:** every paragraph guided by the implicit question "what has
  become normal that wasn't normal before?" Behavioral focus over emotional explanation; contrast
  macro change with micro detail.
- **Emotional core:** calm inevitability.
- **Sentence behavior:** short declarative sentences, high specificity (objects, routines, actions), minimal adjectives.
- **Forbidden Elements:** explicit emotion labels (sad/afraid/happy/etc.), rhetorical questions,
  "suddenly"/sudden-event framing, moral interpretation or lessons, dramatic/hype narration.
- **Perspective:** default "You"; brief limited-omniscient observation allowed only to establish a
  behavioral pattern, then return to "You". Never drift into abstract societal commentary — anchor
  every observation in the protagonist's immediate lived reality (Observer Drift Rule).

## Stage Structure (LOCKED)
10 stages total including baseline (Stage 0 → Stages 1-9). Full detail in ARC_BUREAU_SPEC.md.
- **Stage 0 — Baseline:** static, no change. Environment, routine, social position, "normal"
  constraints, plus 2+ invisible limitations the protagonist never questions.
- **Stages 1-3 — Intrusion / Early Euphoria:** new condition enters; gains look additive/controllable; no obvious cost yet.
- **Stages 4-5 — Adaptation / Friction:** small trade-offs, maintenance required, normalization begins.
- **Stages 6-7 — Identity Shift:** new system becomes baseline; old identity behaviors break down; external expectations reshape decisions.
- **Stage 8 — System Lock-In:** full constraint environment, no functional return, high consequence density, minimal explanation.
- **Stage 9 — Aftermath (Hollow Equilibrium):** system stabilizes in new form; no resolution/moral framing/meaning. End on a specific, quiet environmental detail.
Transitions render as a plain black screen with the stage title in movie-style title-card text
(LOCKED, see STYLE_GUIDE.md). NO on-screen Level Badge (that is Channel B's device).

## Change Categories (LOCKED — closed system of 5)
Each stage from 1 on introduces EXACTLY ONE irreversible change, belonging to exactly ONE category:
Access, Resource, Social Graph, Constraint, Identity Drift (definitions in ARC_BUREAU_SPEC.md).
No stage introduces more than one category; no category repeats in identical form without escalation.

## Hard Constraints (LOCKED — non-negotiable)
- **One change per stage.** No stacking multiple major shifts.
- **Causal Dependency.** Each stage depends on the previous one.
- **Narrative Swap Test (CRITICAL):** if Stage N and Stage N+1 can be swapped without breaking
  causality, the output FAILS.
- **Compression Curve:** as stages progress, sentence length decreases and consequence weight
  increases. Early = more context/explanation; mid = balanced; late = minimal explanation, maximum
  consequence density.
- **No Filler:** every paragraph introduces one of a new constraint / behavioral adaptation /
  environmental shift / identity shift. No restatement of prior ideas in new wording.
- No emotional naming, no moral framing, no rhetorical questions, no suddenness framing, no
  reorderable stages.

## Length Target (LOCKED)
~10-minute runtime, ~1,500 words. Not inherited from Channel A. Keep in one editable prompt-config block, not scattered through code.

## Narration & Visual Cadence (LOCKED)
- Single continuous narration, one pass, NOT chunked. Revisit only if real 10-min quality tests
  prove single-pass degrades quality.
- Per-paragraph visual prompting (down to per-sentence where a sentence carries its own visual
  beat), NOT per-stage. A stage is a narrative unit, not a visual unit. See STYLE_GUIDE.md.

## QA Gate (shared mechanism)
Same lib/qa.js gate. `gap_logic` and `voice_consistency` blocking; `factual_accuracy`/pacing
advisory. Voice Consistency scores against the Analyst's own Section 06 rubric (to be authored),
rejects at <= 5/10. The Narrative Swap Test and one-change-per-stage are natural `gap_logic`-class
checks, but see OPEN item (a) before wiring them to the existing enum.

## Compliance (inherited + channel emphasis)
Universal hard rules apply and are followed: no real-person likeness, no minors (Part 4). No new
policy gate. Emphasis (logged as a pipeline lesson): the no-real-person rule applies to Arc Bureau's
NARRATION/narrative content too, not just visuals. Never build a concept around a real, identifiable
named individual. Use archetypal/composite framing (e.g. "a gunslinger," not a named real outlaw).
Seed concept bank in REFERENCES.md is archetypal by construction for this reason.

## OPEN / UNRESOLVED — pending Layer 2 planning review (DO NOT DECIDE HERE)
- (a) **Change-category taxonomy.** Whether Arc Bureau's 5 change categories (Access/Resource/Social
  Graph/Constraint/Identity Drift) become a separate taxonomy, or map onto the existing `gap_type`
  enum. UNDECIDED.
- (b) **Pre-written script queue.** Whether the pre-written script queue mechanism is built for this
  channel specifically or pipeline-wide. UNDECIDED.
- (c) **Build sequencing / priority** relative to Channels B-E. UNDECIDED.

## Known Open Items
- Active image + LLM providers not yet pinned in an ArcBureau/config.json (not inherited).
- Analyst Section 06 persona entry + Voice Consistency rubric still to be authored from the spec.
- Color theme TBD in STYLE_GUIDE.md (Banc). Concept seeds in REFERENCES.md only; no bank rows.
- Register Arc Bureau in root NewChannels/CLAUDE.md — held until now-complete (see backlog).

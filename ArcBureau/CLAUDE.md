# Arc Bureau. Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md
#
# NAMING: this channel uses a descriptive show name ("Arc Bureau"), matching the ChannelA-E
# convention of real show names ("Before Now", "FailNation", "Fish Outta Water") rather than a
# letter slot. Folder is ArcBureau/, not ChannelF/.
#
# ⚠️ INCOMPLETE ON PURPOSE. The locked Arc Bureau master system prompt was NOT provided when this
# file was scaffolded (the source paste was a literal placeholder). The Analyst persona body and
# the stage-mechanic definitions below are STUBBED with TODO markers. Do not treat the stubbed
# sections as spec, and do not invent their contents — paste the canonical document and fill them
# in verbatim. Everything outside the TODO blocks is a real locked decision and is safe to rely on.

## Inheritance (READ FIRST)
Arc Bureau runs on Channel A's shared infrastructure only: the flyt- agent set, the LLM/image
provider registries, the QA gate, the assembly pipeline, and the Telegram approval flow (Master
Doc Section 03c). It inherits NONE of Channel A's creative tuning. Its persona ("The Analyst"),
prompt content, length target, and provider choices are its own. Do not copy Channel A's "Reluctant
Witness" persona, Story Ladder/Kallaway prompt content, or length target into this channel.

## Persona (LOCKED — "The Analyst")
Voice identity that governs word choice, framing, and worldview in every line. Identity stays
implicit, never stated. Injected first in the script-generator system prompt, ahead of format
rules. Will live in the frozen Section 06 machine-readable copy (agents/lib/personas.js) once the
canonical text is in hand.

<!-- TODO(locked-spec): paste the Analyst persona VERBATIM from the Arc Bureau master system prompt.
     Required sub-blocks, at Channel A's concreteness level (see ChannelA persona in Section 06):
       - Decision Framework (how the Analyst decides what matters in a topic)
       - Default Lens (the instinctive angle on ANY subject)
       - Emotional core
       - Sentence behavior / style
       - Forbidden elements / shortcuts
     Do NOT fabricate these. They are locked authored spec with a canonical source. -->

## Stage Structure (LOCKED — pending spec text)
The video is built as an ordered sequence of stages, where each stage represents exactly ONE change.
Stage transitions are rendered as a plain black screen with the stage title in movie-style
title-card text (LOCKED, see STYLE_GUIDE.md). There is NO on-screen Level Badge (that is Channel B's
device, deliberately not used here).

### Hard Constraints (named LOCKED, definitions pending spec text)
- **One change per stage.** Each stage introduces exactly one change and no more.
- **Narrative Swap Test.** <!-- TODO(locked-spec): paste the exact definition + pass/fail procedure
  from the master doc. Named as a hard constraint; its mechanic is not yet on disk. -->
- **Compression Curve.** <!-- TODO(locked-spec): paste the exact definition from the master doc —
  how information density / pacing changes across the stage sequence. Not yet on disk. -->
- **No emotional naming.** Do not name the emotion; render the change, let it land unlabeled.
- **No moral framing.** Do not editorialize or draw a lesson.
- **No rhetorical questions.**
<!-- TODO(locked-spec): if the master doc defines additional stage constraints, add them here
     verbatim. Confirm the four unlabeled constraints above (no emotional naming / no moral framing /
     no rhetorical questions / one change per stage) match the doc's exact wording once available. -->

## Length Target (LOCKED)
Roughly 10-minute target runtime, about 1,500 words. Not inherited from Channel A's 650-750 word
block. Set this in Arc Bureau's own prompt configuration; do not scatter the number through code
(same discipline as Channel A's single TARGET LENGTH block).

## Narration (LOCKED)
Single continuous narration. Generate the full script in one pass, NOT chunked/segmented
generation. Revisit chunking only if later quality testing on real 10-minute runs proves a single
pass degrades quality; until that evidence exists, single-pass is the decision, not a default to
second-guess.

## Visual Prompting Cadence (LOCKED)
Per-paragraph visual prompting, NOT per-stage. This matches Channel A's tight script-to-still sync
discipline (stills track the prose closely). Per-sentence granularity is allowed where the prose
warrants it (see STYLE_GUIDE.md). A stage is a narrative unit, not a visual unit — do not let one
still cover a whole stage.

## QA Gate (shared mechanism)
Same lib/qa.js gate as the rest of the pipeline. `gap_logic` and `voice_consistency` blocking;
`factual_accuracy` and pacing advisory. Voice Consistency scores against the Analyst's own Section
06 rubric (to be written with the persona), not Channel A's rubric, and rejects at <= 5/10.

## Compliance (inherited + a channel-specific emphasis)
The universal hard rules apply and are already followed: no real-person likeness, no depiction of
minors (Part 4). No new independent policy gate.

Channel-specific emphasis (already logged as a pipeline lesson): the no-real-person rule applies to
Arc Bureau's NARRATIVE/NARRATION content too, not just visuals. Never build a concept around a real,
identifiable named individual (public figures, historical figures, especially any true-crime /
convicted-criminal figures). Use fictional/archetypal/composite framing instead (e.g. "a
gunslinger," not a named real outlaw). The seeded concept bank in REFERENCES.md is archetypal by
construction for exactly this reason.

## OPEN / UNRESOLVED — pending a Layer 2 planning review (DO NOT DECIDE HERE)
These three are explicitly not settled. Do not resolve them unilaterally in this file or in code.
- (a) **Change-category taxonomy.** Whether Arc Bureau's change-categories become a separate
  taxonomy of their own, or map onto the existing `gap_type` enum. UNDECIDED.
- (b) **Pre-written script queue.** Whether the pre-written script queue mechanism gets built for
  this channel specifically, or pipeline-wide. UNDECIDED.
- (c) **Build sequencing / priority** relative to Channels B-E. UNDECIDED.

## Known Open Items
- ⚠️ Analyst persona body + Narrative Swap Test + Compression Curve definitions are STUBBED
  (TODO markers above). Paste the locked master system prompt and fill verbatim before any build.
- Active image + LLM providers not yet pinned in an ArcBureau/config.json (not inherited).
- The three OPEN items above pending Layer 2 review.
- Color theme TBD in STYLE_GUIDE.md (Banc to define separately).
- Concept bank seeds logged in REFERENCES.md only; no entity_situation_bank rows populated (separate
  decision, out of scope here).

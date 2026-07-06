# Channel D ("Fun History"-style long-form, name TBD). Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md
# STATUS: CONCEPT-STAGE. No technical build work has started. No pipeline exists yet.

## Inheritance (READ FIRST)
When this channel is built, it will run on Channel A's shared infrastructure only: the flyt- agent
set, the LLM/image provider registries, the QA gate, the assembly pipeline, and the Telegram
approval flow (Master Doc Section 03c). It will inherit NONE of Channel A's creative tuning. Its
persona, prompt content, length target, and provider choices will be its own. Do not copy Channel
A's persona or prompt content into this channel.

## Naming (TBD)
No name decided. The working title "Fun History" collides with an existing real channel and must
not be used. A distinct name is required before launch. Naming is a separate task.

## Format (concept)
12 to 20 minute compressed historical timelines. Long-form, single continuous narrative walking a
historical arc from start to finish at a compressed pace. This is the long-form counterpart to
Channel A, but a different format, a different persona, and a different visual approach. It is not
a rename or reskin of Channel A.

## Design Decisions Made So Far
These are real, agreed concept decisions, not a working implementation.
- **Single narrator voice.** One narrator throughout. NOT multi-character voice acting. Narration
  delivery is a single consistent voice for the whole timeline.
- **Three-layer visual approach** (combined per scene):
  1. A real historical photography base layer (the factual/period ground).
  2. Vector map and text overlays for factual anchoring (dates, place names, routes, figures).
  3. Flat 2D cartoon character overlays for comedic reaction beats, layered over the base.
  These three layers combine in the same frame. The comedic 2D layer sits on top of the real
  photography base, with the vector map/text layer anchoring facts.

## Not Yet Decided / Not Yet Built
- No agent wiring, no config.json, no manifests, no shot pipeline. Nothing renders today.
- Persona / narrator voice identity: not written (will get its own Section 06 entry, its own
  Decision Framework, its own Voice Consistency rubric, when the channel moves toward build).
- Active providers: not chosen. The three-layer visual approach implies a compositing step in the
  assembly layer that Channel A's stills-only pipeline does not currently do, this needs its own
  design work before any build.
- Length target: not set (12 to 20 min is the format band, not a tuned prompt target).
- Color theme: TBD in STYLE_GUIDE.md (Banc to define separately).
- Source-content sourcing for the real historical photography base layer: not addressed (licensing
  and provenance for real photographs is an open question, not yet scoped).

## Compliance (inherited)
The universal hard rules apply and are already followed: no real-person likeness, no depiction of
minors. Note the real-photography base layer intersects the real-person rule directly: historical
photographs of identifiable real people fall under Part 4 and its sourcing/consent constraints.
This must be worked through during the build design, it is not resolved here. This channel adds no
new independent policy gate beyond Part 4.

## Known Open Items
- Name not decided (working title collides with a real channel).
- Entire pipeline is concept-stage: no code, no config, no providers chosen.
- Three-layer compositing approach needs its own assembly-layer design before any build.
- Real-photography sourcing/licensing and the real-person overlap under Part 4 both unresolved.

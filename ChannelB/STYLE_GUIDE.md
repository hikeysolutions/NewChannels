# Channel B — (name TBD) — Style Guide

> Naming note: Channel B has no locked name yet. "Ten Deep" was rejected (ties the
> name to a fixed count). "Critical Path" was checked and is unavailable. Full naming
> exercise is deferred (Master Build v2.7, Section 11). Update this header once a name locks.

> Source note: the directive referenced "SPEC v2.0 Section 08 voice/visual notes" for
> Channel B's visual styling. No `ChannelB_SPEC_v2.md` exists on disk. The visual specs
> below are drawn from Master Build v2.7 (Sections 01, 06, 07) plus the build directive's
> own description. Items that could not be confirmed from an on-disk source are marked TBD.

## Narrator Persona
See Master Build v2.7 Section 06 ("The Survivor"). Persona is defined once, in the master
build, and read by `flyt-script-generator.js` at runtime. Not restated here by design.

## Format
Escalation hierarchy. Countdown/ranking content built as an ascending sequence of levels,
each raising the stakes toward the top. Bank-agnostic: works with any entity bank without a
new pipeline. Steal the proven countdown structure, swap the subject.

## Script Structure (escalating levels, in order)
1. Cold open / hook (0-3s) — the promise of the countdown, stakes stated up front
2. Level 1 — entry point, lowest stakes, establishes the ladder
3. Ascending levels (Level 2 → Level N) — each level escalates, one payoff beat per level
4. Threshold beats — call out the levels where "almost everyone makes the same mistake"
5. Top level payoff — the highest-stakes item, the reason to watch to the end

Each level maps to a manifest block carrying `level_badge`, `gap_type`, and `gap_state`
(Master Build Section 00c). Levels are sequential: the ascending Level Badge requires order,
so blocks cannot be reordered freely. A block may open a new tension before the previous
one resolves (`gap_state: opens` before an earlier gap `resolves`), but the level sequence
itself stays fixed.

## Title Formula (LOCKED)
`[Number] + [Adjective] + [Topic] + [Enforcement]`
- Number: 10, 15, 17, 25 (specific numbers often outperform round ones)
- Adjective: emotional/quality signal — Incredible, Terrifying, Regretful, Forbidden, Deadliest
- Topic: the entity — Cities, Animals, Ancient Weapons, Prisons, etc.
- Enforcement: closing command implying consequence — "You Will Regret," "You Must See,"
  "That Actually Exist," "No One Talks About"

Never deviate once it works (Adavia's rule). Stay in wonder/dread-curiosity territory, never
"wrong," "nope," "debunking," or correcting the viewer — this is a curiosity/ranking channel,
not a myth-busting channel.

## Rotation
Same discipline as Channel A: one locked format, one entity bank for the channel's lifetime.
A strong outlier that doesn't fit becomes the next channel, not a pivot (Section 05).
Entity/topic bank pulls from `entity_situation_bank` filtered by `channel = 'channel_b'`.
(Currently zero Channel B rows seeded — see Master Build Section 11 action items.)

## Thumbnail (Section 07)
Single dominant subject, high-contrast, dramatic/exaggerated. Optional number or Level Badge
overlay to reinforce the countdown promise visually. Emotional read: dread-curiosity, not
correction. Generated via NB2, overlay/text via Remotion/HyperFrames or Canva.

## Visual Layout (Section 08)
- **Level Badge (persistent element):** ascending numeric badge (e.g. "01" → "25") shown on
  each level. Animates on block-transition beats (Master Build Section 00c — assembly layer
  unchanged, badge animation as previously specified). This is Channel B's signature on-screen
  element, the equivalent of Channel A's era/timestamp tag.
- **Dashboard styling:** high-contrast grayscale "Status: Active" dashboard treatment for the
  level/status readout — stark, monochrome, systems-readout feel that matches "The Survivor"
  persona's progression-through-a-system framing.
- Stills/hero shots: full-frame, motion on stills, hero clip dropped at its designated timestamp
- Captions: lower third, clean high-contrast sans (exact typeface TBD)
- **Color theme: TBD** — not defined for Channel B anywhere on disk. Must be locked before first
  render (same discipline as title/thumbnail consistency). Do not guess; set explicitly.
- **Caption font / typeface: TBD** — no on-disk source specifies it. Lock alongside color theme.
- Transitions: cuts between levels, escalation pacing tightening toward the top

## Hard Rules
- Genuine script variation every video, never find-and-replace templating (YouTube policy, Section 05)
- QA pass required before generation: `factual_accuracy`, `gap_logic`, and `voice_consistency`
  categories (Master Build Section 00c, Section 06). A video scoring ≤5/10 on the Voice
  Consistency Score is rejected, same discipline as the factual-accuracy gate.
- No two consecutive blocks may repeat the same `gap_type` (Section 00c)
- No publish without Telegram approval (Section 03a)
- Stay in wonder/dread territory, never corrective/debunking framing (Section 01)

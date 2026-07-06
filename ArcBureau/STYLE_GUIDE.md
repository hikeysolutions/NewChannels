# Arc Bureau — Style Guide

> Persona note: the Analyst voice + stage structure are locked in ArcBureau/ARC_BUREAU_SPEC.md (the
> canonical creative spec), summarized in ArcBureau/CLAUDE.md, and read at runtime. Not restated
> here. This guide covers visual/composition only.

## Format
~10-minute long-form (16:9 landscape), single continuous narration, ~1,500 words. Built as an
ordered sequence of stages, each stage representing exactly one change. See ArcBureau/CLAUDE.md for
the locked stage structure and its hard constraints.

## Composition — 2D Vector / Cartoon (LOCKED)
- **2D vector / cartoon illustration style.** NOT stick figures (that is Channel A's minimalist
  look, deliberately not reused here). NOT photorealistic. A fully-drawn but flat 2D cartoon look:
  clean vector shapes, defined characters with real features and expression, illustrated
  backgrounds — more rendered than Channel A's circular-head/dot-eye stick figure, well short of
  photoreal.
- **Consistent character/style identity across the video.** One coherent illustration style and
  reusable character treatment so Arc Bureau reads as one recognizable channel, not a different look
  each video (same consistency discipline as Channel A, different target style). Encode as this
  channel's own CHANNEL_STYLE entry in agents/flyt-stills.py when build starts — do not reuse
  Channel A's stick-figure style key.
- Backgrounds: illustrated 2D scenes supporting the beat, in the same flat vector language as the
  characters. Coherent with the character style, never photoreal environments.

## Still Cadence — Per Paragraph / Per Sentence (LOCKED)
- Stills track the prose closely: roughly one still per paragraph, dropping to per-sentence where a
  sentence carries its own distinct visual beat. This mirrors Channel A's tight script-to-still sync
  discipline.
- A stage is a NARRATIVE unit, not a visual unit. Never let a single still stand in for a whole
  stage — the visuals move with the writing, not with the stage boundaries.
- Motion comes from full-frame Ken Burns / slow-zoom on the stills, same as Channel A (still-driven,
  no dependence on hero video clips for the base narrative).

## Stage Transitions — Black-Screen Title Card (LOCKED)
- Between stages: a plain **black screen** with the **stage title in movie-style title-card text**.
  Clean, centered, cinematic title typography on solid black. This is Arc Bureau's signature
  on-screen transition device.
- **No on-screen Level Badge.** The ascending numeric badge is Channel B's device and is
  deliberately NOT used here. Arc Bureau marks progression with the title card alone.
- Title-card text: clean cinematic type. Exact typeface TBD (lock alongside color theme).

## Captions
- Lower-third, clean high-contrast sans, inside a landscape safe zone. Exact typeface TBD.

## Color Theme
**TBD — open decision, deferred to Banc.** No palette or hex values are specified here on purpose.
Applies to both the 2D vector illustration palette AND the title-card treatment. Lock it before the
first render, same discipline as the other channels. Do not guess; set explicitly.

## Hard Rules
- Genuine variation per video, never find-and-replace templating (Section 05).
- No real, identifiable named individuals in narration OR visuals — archetypal/composite only
  (Part 4; see ArcBureau/CLAUDE.md and tasks/lessons.md).
- No publish without Telegram approval (Section 03a).

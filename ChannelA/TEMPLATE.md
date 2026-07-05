# Channel A — "Before Now" — Composition Template (Section 08)

Companion to `STYLE_GUIDE.md`. STYLE_GUIDE locks the **art style** (what a still looks
like: stick-figure vector, flat backgrounds, data-visual color semantics). This file
locks the **composition and frame layout** (where things sit in frame, how captions and
the era tag are placed, how scenes transition). Art style lives there, layout lives here.
Keep both in sync; neither restates the other.

Scope note: Channel A is **stills only**. There are no hero shots, no video clips
(a photoreal clip would break stick-figure consistency, STYLE_GUIDE "Stills-only").
Everything below is about single still frames and how they are composed and assembled.

---

## 1. Frame layout — where the still sits

**Full-screen only. Locked.**

- Every still fills the whole 1920x1080 frame. There is no corner layout and no
  split-screen layout on Channel A. One scene = one full-frame still.
- Motion is a slow Ken Burns zoom over that full-frame still (zoom drifts from 1.0 to
  1.25 across the shot). This is enforced in `assemble.py` (`scale=...:increase, crop,
  zoompan=z='min(zoom+0.0008,1.25)'`), not in the still prompt.
- Consequence of the Ken Burns crop-and-zoom: the outer edges of every still are
  progressively cropped as the zoom pushes in. Do not place anything you need to keep
  (subject face, a data-visual label, the era tag) hard against an edge. The composition
  safe area is the centered region that survives a 1.25x zoom (roughly the inner 80% of
  the frame).

Why not corner or split: the format is one clean minimalist subject per beat. A single
centered subject on a flat background reads instantly at watch-speed and keeps the
recognizable channel identity. Corner and split layouts add composition noise the format
does not want. If a future beat genuinely needs two subjects side by side, that is a
STYLE_GUIDE/TEMPLATE change to make deliberately, not an ad-hoc per-scene choice.

---

## 2. Captions — the `on_screen_text` field

**Captions are an assembly-stage overlay, not baked into the still.**

- The scene JSON carries `on_screen_text` (1-3 words, per STYLE_GUIDE data-visual rule;
  empty string when a scene has no caption). `manifest.js` documents this field as "the
  assembly-stage caption."
- The caption is drawn over the finished, Ken-Burns'd still at assembly time (ffmpeg
  `drawtext`), so it stays crisp, correctly positioned, and does not zoom or crop with the
  image. Captions must never be baked into the generated still, because the Ken Burns zoom
  would drift and crop them.
- **Position:** lower third, horizontally centered. The caption baseline sits inside the
  bottom safe band (clear of the very bottom edge so the zoom crop never clips it).
- **Style:** clean sans-serif, high contrast against the flat background. Bold weight,
  large enough to read on a phone at a glance. A subtle dark scrim or outline behind the
  text where the background is light, so contrast holds on any scene.
- **Length:** 1-3 words maximum. Longer explanation lives in narration, never on screen
  (STYLE_GUIDE data-visual rule, applied channel-wide).

**Data-visual labels are the one exception to "not baked in."** A number that is part of
the graphic itself (for example "14 hours" printed on a timeline bar) is authored inside
the still via the `visual_prompt` wording and rendered by the image model as part of the
chart. That label is content, not a caption overlay. A scene may therefore carry both a
baked-in graphic label and a separate lower-third `on_screen_text` caption; keep them from
saying the same thing twice.

---

## 3. Persistent on-screen element — the era / timestamp tag

**Also an assembly-stage overlay.**

- A small era/timestamp tag, for example "Viking Age, c. 900 AD", persists on screen to
  anchor the period (STYLE_GUIDE "Persistent element"). It is sourced from the scene
  `render.era` (and location where useful), formatted for display.
- **Position:** top-left or top-right corner, inside the safe area (clear of the edge so
  the zoom crop never clips it). Pick one corner per channel and keep it fixed.
- **Style:** small, quiet, lower visual weight than the caption. Same sans family, reduced
  size and opacity. It labels, it does not shout.
- Like the caption, it is drawn at assembly over the still, so it holds still while the
  image slowly zooms.

---

## 4. Transitions between scenes

- **Soft cuts** between beats, still to still (STYLE_GUIDE "Transitions"). No hero-clip
  inserts (there are none on Channel A), no hard wipes, no flashy transitions.
- Motion continuity comes from the per-still Ken Burns zoom, so consecutive soft cuts read
  as a calm, continuous drift rather than a slideshow.
- Data-visual scenes are brief palette cleansers punctuating the character scenes
  (STYLE_GUIDE "Pacing"): same soft-cut treatment, no special transition.

---

## 5. What constrains the still generator vs. what assembly owns

Clear division of responsibility so nothing is authored in the wrong layer:

| Concern | Owned by | Notes |
|---|---|---|
| Art style (stick-figure, flat bg, data-visual colors) | still generator (`flyt-stills.py` CHANNEL_STYLE / DATA_VISUAL_STYLE) | via `build_prompt` |
| Subject content / era accuracy | still generator (`render` block) | era/location/subject descriptors |
| Data-visual baked-in label | still generator (`visual_prompt` wording) | part of the graphic |
| Full-screen framing + Ken Burns motion | assembly (`assemble.py`) | scale-fill, crop, zoompan |
| Lower-third caption overlay | assembly (unbuilt) | from `on_screen_text` |
| Era/timestamp tag overlay | assembly (unbuilt) | from `render.era` |
| Soft cuts | assembly (`assemble.py`) | still to still |

**Composition safe area (the one thing the still generator should respect from this
file):** keep the primary subject centered and clear of the outer edges, and leave the
lower third and the chosen top corner uncluttered, so the assembly-stage caption and era
tag land on clean space once that overlay layer is built. See the wiring note below for
current status.

---

## 6. Current implementation status (as of this commit)

Honest state, so nobody assumes more is wired than is:

- Full-screen framing + Ken Burns: **built** (`assemble.py`).
- Soft cuts: **built** (`assemble.py` concat).
- Data-visual baked-in labels: **built** (via `visual_prompt`).
- Lower-third caption overlay: **not built.** `on_screen_text` is generated and validated
  but rendered nowhere yet.
- Era/timestamp tag overlay: **not built.**
- Still-generator safe-zone constraint: **not wired** (see Section 5 note). Because the
  caption and era-tag overlays do not exist yet, a safe-zone clause on the still prompt
  would be building ahead of need. Add it in the same change that builds the assembly-stage
  overlay, so the two ship together and the constraint can be verified against a real
  caption on a real still.

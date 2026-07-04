# Channel A — "Before Now" — Style Guide

## Format
Historical curiosity. Question-driven single-topic videos: "What Did [Entity] Do [Situation]?"
Proven template (Zenn's "What Did Ancient Humans Do at Night?"). Steal the format, swap the subject.

## Script Structure (5 beats, in order)
1. Hook question (0-3s) — the exact title question, asked out loud
2. Environment / context setup — where and when, set the scene
3. Behavioral explanation — what they actually did and why
4. Hidden detail reveal — the surprising specific most people never hear
5. Emotional payoff — the human throughline that lands the ending

## Title Formula (LOCKED)
"What Did [Entity] Do [Situation]?"
Never deviate once it works (Adavia's rule). Entity and situation both pull from entity_situation_bank.

## Rotation Axes (swap one, keep the other)
- Entity: Ancient Humans, Romans, Aztecs, Vikings, Medieval Peasants, Frontier Settlers, WWII Soldiers
- Situation: at night, when sick, during war, when it rained, when someone died, before a wedding

## Thumbnail (Section 07)
Text-forward treatment (confirmed against the Zenn reference channel — replaces the earlier
"3-subject cartoon style" description, which did not match what's actually observed).
- Bold, high-contrast title text is the dominant visual element, often paired with a single accent color.
- One central character reacting with an exaggerated expression.
- Minimal supporting elements — not a crowded 3-subject layout.
Emotional read is intrigue, not shock.

## Visual Layout (Section 08)
Confirmed against the Zenn reference channel (replaces the earlier photorealistic assumption).
- Character style: simple 2D stick-figure / vector illustration — circular head, dot eyes, thin
  line-drawn limbs, minimal detail. Genuinely minimalist: NOT photorealistic, NOT fully-rendered 2D animation.
- Consistent character design: one reusable character model (same basic proportions and features,
  in visual_prompt terms) so the channel has a recognizable, consistent identity across videos, not a
  different look each time. Encoded as CHANNEL_STYLE["channel_a"] in agents/flyt-stills.py.
- Backgrounds: flat or simply-illustrated — solid colors with at most one simple prop/scenery
  silhouette (a tree, a cave, terrain). Never detailed or photoreal environments.
- Stills/hero shots: full-frame, Ken Burns / slow-zoom motion on stills
- Captions: lower third, clean sans, high contrast
- Color theme: locked per channel (TBD, set before scaling)
- Transitions: soft cuts between beats, hero clip drops at its designated timestamp
- Persistent element: small era/timestamp tag (e.g. "Viking Age, c. 900 AD")

## Hard Rules
- Genuine script variation every video, never find-and-replace templating (YouTube policy, Section 05)
- Historical accuracy pass required before generation — flag invented claims, don't ship them (Section 03 step 2)
- No publish without Telegram approval (Section 03a)

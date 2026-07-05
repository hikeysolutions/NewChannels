# Channel A ("Before Now"). Claude Code Rules
# Channel-specific. Inherits everything in ../CLAUDE.md

## Persona (LOCKED)
"The Reluctant Witness". Voice identity that governs word choice, framing, and worldview in every line. Full spec lives in Master Doc Section 06, and the frozen machine-readable copy is in agents/lib/personas.js (identity stays implicit, never stated). Injected first in the Groq system prompt, ahead of format rules.

## Title Formula (LOCKED)
"What Did [Entity] Do [Situation]?" Never deviate once it works (Adavia's rule). Entity and situation both pull from entity_situation_bank. Rotation: swap one axis, keep the other.

## Active Providers
- Image: GPT Image 2 via Atlas Cloud (gpt-image-2-atlas), async-poll, quality low, ~$0.008/image, sync per-scene path at concurrency 8. Not batch-capable, so it never touches the Gemini batch code path.
- Image fallback: Gemini NB2 batch (gemini-nb2-batch), verified one-config-line swap. Flip ChannelA/config.json image_model back to it and the batch path still works.
- LLM: Groq (openai/gpt-oss-120b) primary, Cerebras fallback. Config-ordered chain in config/llm-models.json, resolved by lib/llm_registry.js. Adding or reordering providers is a config edit, not a code change.

## Length Target
Tunable, not a magic number scattered through the code. Lives in one editable TARGET LENGTH block in lib/groq.js. Current default: roughly 650 to 750 words (about 4 to 5 min spoken), with a "do not conclude before ~700 words" floor. Reach length by expanding locked beats with real concrete detail, never padding.

## Prompt Craft (in lib/groq.js)
The Groq system prompt stacks: Section 06 persona, gap-dynamics arc, and the Story Ladder. Recent refinements layered in: Story Ladder rules (early personal stakes, no tactical closer) plus Kallaway retention rules (speed to value in the first 5 seconds, quantitative anchors scaled to runtime).

## QA Gate (lib/qa.js)
Genuine hard stop, verified against a bad fixture. Four categories:
- factual_accuracy (advisory, qwen fact-check, logged to qa_flags for review, never gates).
- gap_logic (BLOCKING, deterministic gap_state stagnation over the scene chain).
- voice_consistency (BLOCKING, Section 06 five-question rubric out of 10, rejects at <= 5).
- data_visual_pacing (advisory, deterministic, logged for weekly human review, never gates).
Only gap_logic and voice_consistency halt generation.

## Known Open Items
- TEMPLATE.md Section 08 safe-zone clause is written but NOT wired into flyt-stills.py. Deferred on purpose until the caption/era-tag overlay exists (no overlay yet means no reason to constrain the still prompt).
- Verify the strengthened length-target result on the next real long-form run.

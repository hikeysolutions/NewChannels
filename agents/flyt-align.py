#!/usr/bin/env python3.11
"""flyt-align.py - forced alignment (stage 4).

Aligns each beat's KNOWN narration text to its rendered WAV using stable-ts
(openai-whisper base backend), producing word-level timestamps. We already know
the exact narration (it is what VoxCPM2 was given), so this is FORCED ALIGNMENT
of known text, not open transcription — more accurate and it never invents words.

Those timestamps drive:
  - stage 5 (length verification): aligned_end vs the real WAV duration, and the
    total spoken duration vs the target length band.
  - stage 6 (shot segmentation): content-aware ~2.5-3s cuts on clause boundaries,
    using real spoken timing instead of a fixed clock.

Reads, from the channel's manifests/ dir:
  <slug>.json            manifest (scenes[].narration = the exact spoken text)
  <slug>.narration.json  narrator sidecar (tracks[].wav, one wav per beat)
Writes:
  <slug>.align.json      per-beat word timestamps + durations

Memory: the base model is ~1 GB and is loaded ONLY for a real run, after the
narrator subprocess has already exited (peak = max(VoxCPM, whisper), not the sum).

Usage:
  python3.11 agents/flyt-align.py --channel channel_a --manifest <path>
  python3.11 agents/flyt-align.py --channel channel_a --manifest <path> --model base --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}
# base is the sweet spot on this 8 GB M1: ~1 GB resident, forced alignment of
# known text does not need a larger model's transcription accuracy.
DEFAULT_MODEL = "base"
# Alignment-integrity tolerance is enforced in stage 5, not here; this agent just
# records the raw numbers (aligned_end + wav duration) for that check to use.


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="flyt-align.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    p.add_argument("--manifest", required=True, help="path to <slug>.json manifest")
    p.add_argument("--model", default=DEFAULT_MODEL, help="whisper model size (default base)")
    p.add_argument("--dry-run", action="store_true", help="plan only; load no model, write nothing")
    return p.parse_args(argv)


def resolve_manifest_path(path):
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def resolve_asset(path):
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def load_json(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"required input missing: {path}")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def ffprobe_duration(path):
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {proc.stderr.strip()}")
    try:
        return round(float(proc.stdout.strip()), 3)
    except ValueError:
        raise RuntimeError(f"ffprobe returned no duration for {path}")


def load_inputs(manifest_path, channel):
    """Return (manifest, beats) where each beat = (index, narration_text, wav_abs)."""
    manifest = load_json(manifest_path)
    if manifest.get("channel") != channel:
        raise ValueError(f"manifest channel '{manifest.get('channel')}' != --channel '{channel}'")
    scenes = manifest.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("manifest.scenes must be a non-empty array")

    slug = os.path.splitext(os.path.basename(manifest_path))[0]
    manifests_dir = os.path.dirname(manifest_path)
    narration = load_json(os.path.join(manifests_dir, f"{slug}.narration.json"))
    wav_by_index = {}
    for t in narration.get("tracks", []):
        idx, rel = t.get("index"), t.get("wav")
        if idx is not None and rel:
            wav_by_index[idx] = resolve_asset(rel)

    beats = []
    for i, scene in enumerate(scenes):
        text = (scene.get("narration") or "").strip()
        if not text:
            raise ValueError(f"scene[{i}]: narration is empty; cannot align")
        wav = wav_by_index.get(i)
        if not wav or not os.path.isfile(wav):
            raise FileNotFoundError(f"scene[{i}]: narration wav not found ({wav}); run flyt-narrator first")
        beats.append((i, text, wav))
    return manifest, slug, beats


def align_beat(model, wav_abs, text):
    """Force-align known text to audio; return (words, aligned_end)."""
    result = model.align(wav_abs, text, language="en")
    words = []
    for w in result.all_words():
        start = round(float(w.start), 3)
        end = round(float(w.end), 3)
        if end <= start:  # never emit a zero/negative-length word (clamp to +1ms)
            end = round(start + 0.001, 3)
        words.append({"word": w.word.strip(), "start": start, "end": end})
    aligned_end = round(words[-1]["end"], 3) if words else 0.0
    return words, aligned_end


def main(argv):
    args = parse_args(argv)
    manifest_path = resolve_manifest_path(args.manifest)
    manifest, slug, beats = load_inputs(manifest_path, args.channel)
    channel_dir = os.path.join(ROOT, CHANNEL_DIRS[args.channel])
    sidecar_path = os.path.join(channel_dir, "manifests", f"{slug}.align.json")

    info(f"channel={args.channel} title=\"{manifest.get('title')}\" beats={len(beats)} model={args.model}")

    if args.dry_run:
        for i, text, wav in beats:
            info(f"  beat {i:02d}: {len(text.split())} words -> {os.path.relpath(wav, ROOT)}")
        info(f"[dry-run] {len(beats)} beats, no model loaded, no alignment written")
        return 0

    import stable_whisper  # imported lazily so --dry-run needs no torch/model
    t0 = time.time()
    model = stable_whisper.load_model(args.model)
    info(f"model '{args.model}' loaded in {time.time() - t0:.1f}s")

    out_beats = []
    total_audio = 0.0
    run_start = time.time()
    for i, text, wav in beats:
        audio_dur = ffprobe_duration(wav)
        total_audio += audio_dur
        bt = time.time()
        words, aligned_end = align_beat(model, wav, text)
        info(f"beat {i:02d}: {len(words)} words, aligned_end={aligned_end}s vs audio={audio_dur}s "
             f"in {time.time() - bt:.1f}s")
        out_beats.append({
            "index": i,
            "wav": os.path.relpath(wav, ROOT),
            "audio_duration_seconds": audio_dur,
            "aligned_end_seconds": aligned_end,
            "word_count": len(words),
            "words": words,
        })

    sidecar = {
        "channel": args.channel,
        "title": manifest.get("title"),
        "source_manifest": os.path.relpath(manifest_path, ROOT),
        "model": args.model,
        "total_audio_seconds": round(total_audio, 3),
        "beats": out_beats,
    }
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
        fh.write("\n")

    info(f"[done] aligned {len(out_beats)} beats ({round(total_audio, 1)}s audio) "
         f"in {time.time() - run_start:.1f}s -> {os.path.relpath(sidecar_path, ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

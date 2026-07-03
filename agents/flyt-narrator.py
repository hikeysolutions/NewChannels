#!/usr/bin/env python3.11
"""flyt-narrator.py - Session 2 (narration stage).

Shared across both channels, parameterized by --channel (Section 03c).
Reads a scene manifest produced by flyt-script-generator.js and renders one
narration WAV per scene using VoxCPM2 running locally on CPU.

DEVICE IS CPU ON PURPOSE. Do not "fix" this to MPS.
This Mac Mini has 8 GB unified RAM. MPS has no bfloat16, so VoxCPM2 upcasts
bfloat16 -> float32 (~9 GB of weights), which exceeds physical RAM and dies with
"MPS backend out of memory". Diagnosed 2026-07-02, see NewChannels/tasks/lessons.md.
MPS is reachable but cannot hold the model here. CPU keeps bfloat16 and can lean
on virtual memory. Raising PYTORCH_MPS_HIGH_WATERMARK_RATIO would swap-thrash the
box that runs Susan. Leave device="cpu".

Usage:
  python3.11 agents/flyt-narrator.py --channel channel_a --manifest ChannelA/manifests/<slug>.json
  python3.11 agents/flyt-narrator.py --channel channel_a --manifest <path> --dry-run
"""

import argparse
import json
import os
import sys
import time

import validate  # shared validation gate (same agents/ dir); provides check_audio + run_with_retry

SAMPLE_RATE = 16000  # VoxCPM2 emits 16 kHz mono (confirmed via smoke test)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="flyt-narrator.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    p.add_argument("--manifest", required=True, help="path to the scene manifest JSON (abs or repo-relative)")
    p.add_argument("--dry-run", action="store_true", help="validate + plan only; load no model, write no audio")
    return p.parse_args(argv)


def resolve_manifest_path(manifest_arg):
    """Accept an absolute path or one relative to the repo root. Fail fast."""
    candidate = manifest_arg if os.path.isabs(manifest_arg) else os.path.join(ROOT, manifest_arg)
    if not os.path.isfile(candidate):
        raise FileNotFoundError(f"manifest not found: {candidate}")
    return candidate


def load_manifest(path, channel):
    """Read and validate the manifest at the system boundary (never trust it)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("manifest is not a JSON object")
    if data.get("channel") != channel:
        raise ValueError(f"manifest channel '{data.get('channel')}' does not match --channel '{channel}'")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("manifest.scenes must be a non-empty array")
    for i, scene in enumerate(scenes):
        narration = scene.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            raise ValueError(f"scene[{i}].narration must be a non-empty string")
        if not isinstance(scene.get("start"), (int, float)) or not isinstance(scene.get("end"), (int, float)):
            raise ValueError(f"scene[{i}].start and end must be numbers")
    return data, scenes


def load_model():
    """Load VoxCPM2 once on CPU with local weights only. Kept warm by the caller
    so the multi-minute load cost is paid once per run, never per scene."""
    from voxcpm import VoxCPM  # imported lazily so --dry-run needs no torch

    t0 = time.time()
    info("loading VoxCPM2 on CPU (local files only, denoiser off)...")
    model = VoxCPM.from_pretrained(
        device="cpu",              # see module docstring — do not change to mps
        local_files_only=True,     # weights are cached; never hit the network
        load_denoiser=False,       # no reference audio -> denoiser is dead weight (lessons 2026-07-02)
    )
    info(f"model loaded in {time.time() - t0:.1f}s")
    return model


def render_scene(model, text):
    """Generate one scene's audio as a mono float32 numpy array. Silence/clipping
    validation and retry-once-then-alert live in validate.py (Section 03 step 6),
    so the discipline is shared with every other asset, not re-implemented here."""
    import numpy as np

    def produce():
        audio = model.generate(text=text)
        return np.asarray(audio, dtype="float32").reshape(-1)

    samples, report = validate.run_with_retry(
        produce,
        lambda s: validate.check_audio(samples=s, sample_rate=SAMPLE_RATE),
        label="narration",
    )
    rms = next(c.metrics["rms"] for c in report.checks if c.name == "silence")
    return samples, rms


def write_wav(path, samples):
    """Write 16 kHz mono WAV. Prefer soundfile; fall back to the stdlib wave
    module so a missing optional dep never blocks a render."""
    import numpy as np

    try:
        import soundfile as sf

        sf.write(path, samples, SAMPLE_RATE)
        return "soundfile"
    except Exception:
        import wave

        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm.tobytes())
        return "wave"


def main(argv):
    args = parse_args(argv)
    manifest_path = resolve_manifest_path(args.manifest)
    manifest, scenes = load_manifest(manifest_path, args.channel)

    slug = os.path.splitext(os.path.basename(manifest_path))[0]
    channel_dir = os.path.join(ROOT, CHANNEL_DIRS[args.channel])
    out_dir = os.path.join(channel_dir, "tmp", slug)
    sidecar_path = os.path.join(channel_dir, "manifests", f"{slug}.narration.json")

    info(f"channel={args.channel} title=\"{manifest.get('title')}\" scenes={len(scenes)}")
    info(f"output dir: {out_dir}")

    if args.dry_run:
        total_chars = sum(len(s["narration"]) for s in scenes)
        info(f"[dry-run] {len(scenes)} scenes, {total_chars} narration chars, no model loaded, no audio written")
        return 0

    os.makedirs(out_dir, exist_ok=True)
    model = load_model()

    tracks = []
    run_start = time.time()
    for i, scene in enumerate(scenes):
        wav_path = os.path.join(out_dir, f"scene_{i:02d}.wav")
        t0 = time.time()
        samples, level = render_scene(model, scene["narration"].strip())
        writer = write_wav(wav_path, samples)
        duration = len(samples) / SAMPLE_RATE
        info(
            f"scene {i:02d}: {duration:.1f}s audio (rms={level:.3f}) in {time.time() - t0:.1f}s "
            f"via {writer} -> {os.path.relpath(wav_path, ROOT)}"
        )
        tracks.append({
            "index": i,
            "wav": os.path.relpath(wav_path, ROOT),
            "audio_duration_seconds": round(duration, 3),
            "scene_start": scene["start"],
            "scene_end": scene["end"],
            "target_duration_seconds": round(scene["end"] - scene["start"], 3),
        })

    sidecar = {
        "channel": args.channel,
        "title": manifest.get("title"),
        "source_manifest": os.path.relpath(manifest_path, ROOT),
        "sample_rate": SAMPLE_RATE,
        "device": "cpu",
        "tracks": tracks,
    }
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
        fh.write("\n")

    info(
        f"[done] {len(tracks)} narration tracks in {time.time() - run_start:.1f}s "
        f"-> {os.path.relpath(sidecar_path, ROOT)}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

#!/usr/bin/env python3.11
"""assemble.py - Session 3 (assembly stage).

Plain-ffmpeg assembler. Open Design / HyperFrames evaluation is deferred per the
Session 2/3 audit (Master Build v2.7 Section 09), so this stage uses ffmpeg
directly rather than a motion-graphics framework. Shared across both channels,
parameterized by --channel; this session only runs Channel A.

Takes a slug and reads, from the channel's manifests/ dir:
  <slug>.json            scene manifest (Section 00c; gap_type/gap_state present,
                         not acted on yet this session)
  <slug>.stills.json     flyt-stills.py sidecar (still asset per still-scene)
  <slug>.hero.json       flyt-hero.py sidecar (hero mp4 per hero-scene)
  <slug>.narration.json  flyt-narrator.py sidecar (one wav per scene)

For each scene, in manifest order:
  - still scene -> Ken Burns / slow-zoom motion over the still (Section 02 assembly row)
  - hero scene -> the hero clip dropped in at its designated timestamp
  - the scene's narration wav is muxed as the scene's audio

Duration reconciliation (Section 03 step 4 / tasks/lessons.md :30-31):
  Narration is the ground truth and is NEVER truncated (cutting it drops words).
  Each scene's rendered length D = max(narration_audio, scene_target[, hero_clip]).
  Stills zoom for the full D. Hero clips shorter than D freeze their last frame
  (tpad clone) to fill; audio shorter than D is padded with trailing silence.
  Nothing is silently truncated.

Output: one rendered MP4 at <channel>/outputs/<slug>.mp4, then run through the
existing validate.check_video (ffprobe + 4-position black-frame + aspect) using
validate.run_with_retry for retry-once-then-alert (Section 03 step 6). Assembly
is deterministic and free, so the retry re-renders at no API cost.

Usage:
  python3.11 agents/assemble.py --channel channel_a --slug <slug>
  python3.11 agents/assemble.py --channel channel_a --slug <slug> --base /tmp/fixture  # tests
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import alert  # Telegram alert callback for run_with_retry's "then-alert" half
import validate  # shared validation gate (same agents/ dir): check_video + run_with_retry

WIDTH, HEIGHT, FPS = 1920, 1080, 30
SAMPLE_RATE, CHANNELS = 44100, 2
MIN_SCENE_SECONDS = 1.0
DURATION_TOL = 1.5  # concat/encode rounding is looser than a single container

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="assemble.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    p.add_argument("--slug", required=True, help="video slug (manifest basename without .json)")
    p.add_argument("--base", default=None,
                   help="override channel base dir (default <repo>/ChannelX); used by tests")
    return p.parse_args(argv)


def _load_json(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"required input missing: {path}")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def resolve_asset(path):
    """Sidecars store repo-relative paths (relpath from ROOT); tests store absolute
    paths. Accept absolute as-is, else resolve against ROOT."""
    if os.path.isabs(path):
        return path
    candidate = os.path.join(ROOT, path)
    return candidate


def ffprobe_duration(path):
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {proc.stderr.strip()}")
    try:
        return float(proc.stdout.strip())
    except ValueError:
        raise RuntimeError(f"ffprobe returned no duration for {path}")


def _index_by_scene(sidecar, key, asset_field):
    """Map scene index -> resolved asset path for a stills/hero/narration sidecar."""
    out = {}
    for item in sidecar.get(key, []):
        idx = item.get("index")
        rel = item.get(asset_field)
        if idx is None or not rel:
            continue
        out[idx] = resolve_asset(rel)
    return out


def build_plan(base, slug):
    """Read manifest + three sidecars, return an ordered list of per-scene plans."""
    manifests_dir = os.path.join(base, "manifests")
    manifest = _load_json(os.path.join(manifests_dir, f"{slug}.json"))
    stills = _index_by_scene(_load_json(os.path.join(manifests_dir, f"{slug}.stills.json")), "assets", "jpg")
    heroes = _index_by_scene(_load_json(os.path.join(manifests_dir, f"{slug}.hero.json")), "assets", "mp4")
    narration = _index_by_scene(_load_json(os.path.join(manifests_dir, f"{slug}.narration.json")), "tracks", "wav")

    scenes = manifest.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("manifest.scenes must be a non-empty array")

    plan = []
    for i, scene in enumerate(scenes):
        asset_type = scene.get("asset_type")
        target = float(scene.get("end", 0)) - float(scene.get("start", 0))
        wav = narration.get(i)
        if wav and not os.path.isfile(wav):
            raise FileNotFoundError(f"scene {i}: narration wav not found: {wav}")
        audio_dur = ffprobe_duration(wav) if wav else 0.0

        if asset_type == "still":
            src = stills.get(i)
            if not src or not os.path.isfile(src):
                raise FileNotFoundError(f"scene {i} (still): image not found: {src}")
            duration = max(audio_dur, target, MIN_SCENE_SECONDS)
            plan.append({"i": i, "type": "still", "src": src, "wav": wav,
                         "duration": round(duration, 3), "clip_dur": None})
        elif asset_type == "hero":
            src = heroes.get(i)
            if not src or not os.path.isfile(src):
                raise FileNotFoundError(f"scene {i} (hero): clip not found: {src}")
            clip_dur = ffprobe_duration(src)
            duration = max(audio_dur, target, clip_dur, MIN_SCENE_SECONDS)
            plan.append({"i": i, "type": "hero", "src": src, "wav": wav,
                         "duration": round(duration, 3), "clip_dur": clip_dur})
        else:
            raise ValueError(f"scene {i}: asset_type must be 'still' or 'hero' (got {asset_type!r})")
    return manifest, plan


def _audio_filter(has_audio, duration):
    """Narration -> stereo, resampled, padded with trailing silence to exactly D,
    never trimmed short of its own content (apad only extends)."""
    if has_audio:
        return (f"[1:a]aformat=sample_rates={SAMPLE_RATE}:channel_layouts=stereo,"
                f"apad,atrim=0:{duration},asetpts=N/SR/TB[a]")
    # No narration for this scene: synthesize matching silence.
    return (f"anullsrc=channel_layout=stereo:sample_rate={SAMPLE_RATE},"
            f"atrim=0:{duration},asetpts=N/SR/TB[a]")


def render_segment(scene, out_path):
    """Render one scene to a normalized mp4 segment (same codec params for all,
    so the final concat can stream-copy)."""
    d = scene["duration"]
    has_audio = bool(scene["wav"])

    if scene["type"] == "still":
        frames = max(1, round(d * FPS))
        # Scale/crop to fill 1920x1080, then a slow Ken Burns zoom for the whole D.
        vfilter = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},"
            f"zoompan=z='min(zoom+0.0008,1.25)':d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"setsar=1[v]"
        )
        inputs = ["-loop", "1", "-i", scene["src"]]
    else:  # hero
        pad = max(0.0, round(d - scene["clip_dur"], 3))
        tpad = f",tpad=stop_mode=clone:stop_duration={pad}" if pad > 0 else ""
        vfilter = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},setsar=1,fps={FPS}{tpad}[v]"
        )
        inputs = ["-i", scene["src"]]

    if has_audio:
        inputs += ["-i", scene["wav"]]
    afilter = _audio_filter(has_audio, d)
    filtergraph = f"{vfilter};{afilter}"

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *inputs,
        "-filter_complex", filtergraph,
        "-map", "[v]", "-map", "[a]",
        "-t", f"{d}",
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
        "-video_track_timescale", "30000",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"segment render failed (scene {scene['i']}): {proc.stderr.strip()[:500]}")


def concat_segments(segment_paths, out_path):
    """Stream-copy concat (all segments share identical codec params)."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as lf:
        list_path = lf.name
        for p in segment_paths:
            lf.write(f"file '{p}'\n")
    try:
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-f", "concat", "-safe", "0", "-i", list_path,
               "-c", "copy", "-movflags", "+faststart", out_path]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"concat failed: {proc.stderr.strip()[:500]}")
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


def assemble(base, slug):
    """Full assembly. Returns (out_path, expected_duration). Rendered fresh each
    call so validate.run_with_retry can re-run it cleanly (no API cost)."""
    manifest, plan = build_plan(base, slug)
    out_dir = os.path.join(base, "outputs")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{slug}.mp4")
    total = round(sum(s["duration"] for s in plan), 3)

    with tempfile.TemporaryDirectory(prefix=f"assemble-{slug}-") as work:
        segments = []
        for s in plan:
            seg = os.path.join(work, f"seg_{s['i']:02d}.mp4")
            info(f"scene {s['i']:02d} [{s['type']}] {s['duration']}s -> segment")
            render_segment(s, seg)
            segments.append(seg)
        info(f"concat {len(segments)} segments -> {os.path.relpath(out_path, base)}")
        concat_segments(segments, out_path)
    return out_path, total


def main(argv):
    args = parse_args(argv)
    base = args.base or os.path.join(ROOT, CHANNEL_DIRS[args.channel])

    # The expected total duration comes out of assemble(); stash it so the
    # validate closure can check against it after each (re)render.
    state = {"expected": None}

    def produce():
        out_path, expected = assemble(base, args.slug)
        state["expected"] = expected
        return out_path

    # retry-once-then-alert owned by validate.py; assembly is deterministic + free.
    out_path, report = validate.run_with_retry(
        produce,
        lambda p: validate.check_video(p, expected_aspect="16:9",
                                       expected_duration=state["expected"],
                                       duration_tol_seconds=DURATION_TOL),
        label=f"assemble {args.slug}",
        alert=alert.make_alert(f"assemble / {args.slug}"),
    )
    dur = next((c.metrics.get("duration") for c in report.checks if c.name == "duration"), None)
    info(f"[done] {os.path.relpath(out_path, base)} validated ok (duration={dur}s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

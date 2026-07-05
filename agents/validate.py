#!/usr/bin/env python3.11
"""validate.py - Session 2 shared validation gate.

Post-download validation for every generated asset, plus the reusable
retry-once-then-alert pattern. Pattern borrowed from OpenMontage's review-gate
design and hand-coded here as plain code, no framework dependency (Section 03
step 6, Master Build). ffprobe/ffmpeg only for media; numpy only for in-memory
audio.

What the doc mandates (Section 03 step 6, line 445):
  - ffprobe check: duration + resolution MATCH THE REQUEST (no absolute numbers
    in the doc; the caller passes expectations, this module hardcodes none)
  - frame extraction at 4 positions to catch black/corrupt frames (video)
  - audio level analysis to catch silence/clipping (narration)
  - retry-once-then-alert; never proceed on a failed/truncated generation

Chosen defaults (NOT from the doc, all overridable): 4 frame positions at
15/38/62/85% (interior, avoids intentional head/tail black), duration tolerance
+/-0.75s, black-frame threshold YAVG < 20 on the 0-255 luma scale (above the
limited-range black level of 16 so TV-range black is caught).

Module usage (Python agents):
  from validate import check_audio, check_video, check_still, run_with_retry
CLI usage (JS wrappers shell out; prints Report JSON, exit 0=ok / 1=fail):
  python3.11 agents/validate.py still <path> --width 1920 --height 1080
  python3.11 agents/validate.py video <path> --duration 6 --width 1920 --height 1080 [--codec h264]
  python3.11 agents/validate.py audio <path> [--silence-floor 0.005]
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from typing import Callable, Optional, Tuple, TypeVar

T = TypeVar("T")

# Chosen defaults (see module docstring). Not doc values.
DEFAULT_POSITIONS: Tuple[float, ...] = (0.15, 0.38, 0.62, 0.85)
DEFAULT_DURATION_TOL = 0.75
DEFAULT_ASPECT_TOL = 0.03  # relative tolerance on width/height ratio
DEFAULT_BLACK_LUMA_FLOOR = 20.0  # YAVG on 0-255; below this reads as black. Note: limited-range
# ("TV range") video encodes black as luma 16, not 0, so the floor must sit above 16 to catch it.
# Real content averages far higher (test footage ~124), so 20 flags black without false positives.
DEFAULT_SILENCE_RMS_FLOOR = 0.005
DEFAULT_CLIP_CEILING = 0.99
DEFAULT_CLIP_RATIO_MAX = 0.01
YAVG_RE = re.compile(r"lavfi\.signalstats\.YAVG=([0-9.]+)")


# ---- immutable result types (coding-style: no mutation) ----
@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str
    metrics: dict


@dataclass(frozen=True)
class Report:
    path: str
    ok: bool
    checks: Tuple[Check, ...]


def _report(path: str, checks: Tuple[Check, ...]) -> Report:
    return Report(path=path, ok=all(c.ok for c in checks), checks=checks)


# ---- ffprobe / ffmpeg primitives ----
def probe(path: str) -> dict:
    """Parsed ffprobe JSON (format + streams). Raises on missing file or decode failure."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"asset not found: {path}")
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _video_stream(probed: dict) -> dict:
    for s in probed.get("streams", []):
        if s.get("codec_type") == "video":
            return s
    raise RuntimeError("no video stream found")


def _frame_luma(path: str, at_seconds: float) -> Optional[float]:
    """Mean luma (YAVG, 0-255) of the single frame at `at_seconds`, via ffmpeg
    signalstats. Returns None if the frame cannot be decoded (corrupt)."""
    with tempfile.NamedTemporaryFile(mode="r", suffix=".txt", delete=False) as tf:
        meta_path = tf.name
    try:
        # -ss (input seek) only when seeking into real video. A single-image still is
        # sampled at t=0, and the JPEG image2 demuxer returns no frame if asked to seek
        # to 0, so omit -ss there. Video positions are always > 0, unchanged.
        seek = ["-ss", f"{at_seconds}"] if at_seconds > 0 else []
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", *seek,
             "-i", path, "-frames:v", "1",
             "-vf", f"signalstats,metadata=print:file={meta_path}", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            return None
        # errors="replace": ffmpeg's metadata=print dumps the frame's embedded
        # metadata too, which for some providers (e.g. GPT Image 2 PNGs carrying
        # C2PA content credentials) contains non-UTF8 bytes. We only need the
        # ASCII lavfi.signalstats.YAVG line, so tolerate undecodable bytes.
        with open(meta_path, "r", encoding="utf-8", errors="replace") as fh:
            m = YAVG_RE.search(fh.read())
        return float(m.group(1)) if m else None
    finally:
        try:
            os.unlink(meta_path)
        except OSError:
            pass


# ---- resolution / duration / codec sub-checks (None expectation => skipped) ----
def _check_resolution(stream: dict, expected_width, expected_height) -> Optional[Check]:
    if expected_width is None and expected_height is None:
        return None
    w, h = stream.get("width"), stream.get("height")
    ok = (expected_width is None or w == expected_width) and (expected_height is None or h == expected_height)
    want = f"{expected_width or '*'}x{expected_height or '*'}"
    return Check("resolution", ok, f"{w}x{h} vs requested {want}", {"width": w, "height": h})


def _check_duration(probed: dict, expected_duration, tol) -> Optional[Check]:
    if expected_duration is None:
        return None
    try:
        actual = float(probed.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        return Check("duration", False, "duration missing from ffprobe output", {"duration": None})
    ok = abs(actual - expected_duration) <= tol
    return Check("duration", ok, f"{actual:.3f}s vs requested {expected_duration:.3f}s (+/-{tol}s)",
                 {"duration": actual, "expected": expected_duration, "tolerance": tol})


def _parse_aspect(spec) -> float:
    """Accept '16:9' or a numeric ratio; return width/height as a float."""
    if isinstance(spec, (int, float)):
        return float(spec)
    w, h = str(spec).split(":")
    return float(w) / float(h)


def _check_aspect(stream: dict, expected_aspect, tol) -> Optional[Check]:
    """Ratio check for APIs that pick pixels from a requested aspect (e.g. NB2
    stills return 1376x768 for a '16:9' request, not exact 1920x1080)."""
    if expected_aspect is None:
        return None
    w, h = stream.get("width"), stream.get("height")
    if not w or not h:
        return Check("aspect", False, "width/height missing from ffprobe output", {"width": w, "height": h})
    want = _parse_aspect(expected_aspect)
    actual = w / h
    ok = abs(actual - want) / want <= tol
    return Check("aspect", ok, f"{w}x{h} ratio {actual:.4f} vs requested {expected_aspect} ({want:.4f}, +/-{tol*100:.0f}%)",
                 {"width": w, "height": h, "ratio": actual, "expected_ratio": want})


def _check_codec(stream: dict, expected_codec) -> Optional[Check]:
    if expected_codec is None:
        return None
    actual = stream.get("codec_name")
    ok = actual == expected_codec
    return Check("codec", ok, f"{actual} vs requested {expected_codec}", {"codec": actual})


def _check_black_frames(path, positions, duration, floor) -> Check:
    """Sample frames across the clip; fail if any is corrupt (undecodable) or black."""
    results, worst_ok = {}, True
    for frac in positions:
        t = round(frac * duration, 3) if duration else 0.0
        luma = _frame_luma(path, t)
        if luma is None:
            results[f"{frac:.2f}"] = "corrupt"
            worst_ok = False
        elif luma < floor:
            results[f"{frac:.2f}"] = f"black(YAVG={luma:.1f})"
            worst_ok = False
        else:
            results[f"{frac:.2f}"] = f"ok(YAVG={luma:.1f})"
    detail = "all sampled frames ok" if worst_ok else f"bad frames: {results}"
    return Check("black_frames", worst_ok, detail, {"positions": results, "floor": floor})


# ---- public asset checks ----
def check_still(path: str, *, expected_width=None, expected_height=None,
                expected_aspect=None, aspect_tol=DEFAULT_ASPECT_TOL,
                black_luma_floor=DEFAULT_BLACK_LUMA_FLOOR) -> Report:
    probed = probe(path)
    stream = _video_stream(probed)
    candidates = (
        _check_resolution(stream, expected_width, expected_height),
        _check_aspect(stream, expected_aspect, aspect_tol),
    )
    checks = [c for c in candidates if c]
    # A still is one frame; sample it once for black/corrupt.
    checks.append(_check_black_frames(path, (0.0,), 0.0, black_luma_floor))
    return _report(path, tuple(checks))


def check_video(path: str, *, expected_duration=None, expected_width=None, expected_height=None,
                expected_aspect=None, aspect_tol=DEFAULT_ASPECT_TOL,
                expected_codec=None, duration_tol_seconds=DEFAULT_DURATION_TOL,
                positions=DEFAULT_POSITIONS, black_luma_floor=DEFAULT_BLACK_LUMA_FLOOR) -> Report:
    probed = probe(path)
    stream = _video_stream(probed)
    try:
        duration = float(probed.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        duration = 0.0
    candidates = (
        _check_resolution(stream, expected_width, expected_height),
        _check_aspect(stream, expected_aspect, aspect_tol),
        _check_duration(probed, expected_duration, duration_tol_seconds),
        _check_codec(stream, expected_codec),
    )
    checks = [c for c in candidates if c]
    checks.append(_check_black_frames(path, positions, duration, black_luma_floor))
    return _report(path, tuple(checks))


def _load_samples(path: str):
    """Load a WAV to a mono float32 numpy array. soundfile preferred, stdlib wave fallback."""
    import numpy as np
    try:
        import soundfile as sf
        data, sr = sf.read(path, dtype="float32", always_2d=False)
        arr = np.asarray(data, dtype="float32")
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        return arr.reshape(-1), sr
    except Exception:
        import wave
        with wave.open(path, "rb") as w:
            sr = w.getframerate()
            frames = w.readframes(w.getnframes())
        arr = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
        return arr.reshape(-1), sr


def check_audio(*, path: str = None, samples=None, sample_rate: int = None,
                silence_rms_floor=DEFAULT_SILENCE_RMS_FLOOR, clip_ceiling=DEFAULT_CLIP_CEILING,
                clip_ratio_max=DEFAULT_CLIP_RATIO_MAX) -> Report:
    """Silence + clipping check. Pass in-memory `samples` (+`sample_rate`) to skip
    the disk round-trip, or a WAV `path`. Exactly one source is required."""
    import numpy as np
    if (samples is None) == (path is None):
        raise ValueError("check_audio requires exactly one of samples= or path=")
    if samples is not None:
        arr = np.asarray(samples, dtype="float64").reshape(-1)
        label = "<in-memory>"
    else:
        loaded, sample_rate = _load_samples(path)
        arr = np.asarray(loaded, dtype="float64").reshape(-1)
        label = path

    n = arr.size
    rms = float(np.sqrt(np.mean(arr * arr))) if n else 0.0
    clipped = int(np.count_nonzero(np.abs(arr) >= clip_ceiling))
    clip_ratio = (clipped / n) if n else 1.0

    silence_ok = n > 0 and rms >= silence_rms_floor
    clip_ok = clip_ratio <= clip_ratio_max
    checks = (
        Check("silence", silence_ok, f"rms={rms:.5f} vs floor {silence_rms_floor} (len={n})",
              {"rms": rms, "floor": silence_rms_floor, "samples": n, "sample_rate": sample_rate}),
        Check("clipping", clip_ok, f"{clip_ratio*100:.2f}% clipped vs max {clip_ratio_max*100:.2f}%",
              {"clip_ratio": clip_ratio, "clipped": clipped, "ceiling": clip_ceiling}),
    )
    return _report(label, checks)


# ---- reusable retry-once-then-alert (the pattern other Python agents call into) ----
def run_with_retry(produce: Callable[[], T], validate: Callable[[T], Report], *,
                   label: str, alert: Callable[[Report], None] = None) -> Tuple[T, Report]:
    """Run produce(); validate the artifact; retry the whole operation ONCE on
    failure; if it still fails, alert (when a Report exists) and raise. Returns
    (artifact, report). A failure is EITHER a produce() exception (e.g. a failed
    generation job) OR a Report that is not ok, so both paths get one retry."""
    last_report = None
    last_exc = None
    for attempt in (1, 2):
        try:
            artifact = produce()
        except Exception as exc:  # noqa: BLE001 - a raised produce() (e.g. a failed job) is retryable
            last_report = None
            last_exc = exc
            if attempt == 1:
                sys.stderr.write(f"[warn] {label}: attempt 1 failed (produce() raised: {exc}); retrying once...\n")
            continue
        # validate() must RETURN a Report. If it raises, that is a bug in the validator,
        # not a transient failure, so let it propagate rather than waste another (often
        # paid) produce() on a pointless retry.
        last_report = validate(artifact)
        if last_report.ok:
            return artifact, last_report
        last_exc = None
        if attempt == 1:
            sys.stderr.write(f"[warn] {label}: attempt 1 failed ({_fail_summary(last_report)}); retrying once...\n")
    if last_report is not None:
        if alert is not None:
            alert(last_report)
        raise RuntimeError(f"{label}: validation failed after retry ({_fail_summary(last_report)})")
    raise RuntimeError(f"{label}: failed after retry (produce() raised: {last_exc})") from last_exc


def _fail_summary(report: Report) -> str:
    return "; ".join(f"{c.name}: {c.detail}" for c in report.checks if not c.ok)


# ---- CLI ----
def _emit(report: Report) -> int:
    sys.stdout.write(json.dumps(dataclasses.asdict(report), indent=2) + "\n")
    return 0 if report.ok else 1


def main(argv) -> int:
    p = argparse.ArgumentParser(prog="validate.py")
    sub = p.add_subparsers(dest="cmd", required=True)

    ps = sub.add_parser("still")
    ps.add_argument("path")
    ps.add_argument("--width", type=int)
    ps.add_argument("--height", type=int)
    ps.add_argument("--aspect", help="e.g. 16:9 — ratio check for aspect-controlled APIs like NB2")

    pv = sub.add_parser("video")
    pv.add_argument("path")
    pv.add_argument("--duration", type=float)
    pv.add_argument("--width", type=int)
    pv.add_argument("--height", type=int)
    pv.add_argument("--aspect", help="e.g. 16:9 — ratio check for aspect-controlled video APIs")
    pv.add_argument("--codec")
    pv.add_argument("--duration-tol", type=float, default=DEFAULT_DURATION_TOL)

    pa = sub.add_parser("audio")
    pa.add_argument("path")
    pa.add_argument("--silence-floor", type=float, default=DEFAULT_SILENCE_RMS_FLOOR)

    args = p.parse_args(argv)
    if args.cmd == "still":
        return _emit(check_still(args.path, expected_width=args.width, expected_height=args.height,
                                 expected_aspect=args.aspect))
    if args.cmd == "video":
        return _emit(check_video(args.path, expected_duration=args.duration, expected_width=args.width,
                                 expected_height=args.height, expected_aspect=args.aspect,
                                 expected_codec=args.codec, duration_tol_seconds=args.duration_tol))
    if args.cmd == "audio":
        return _emit(check_audio(path=args.path, silence_rms_floor=args.silence_floor))
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

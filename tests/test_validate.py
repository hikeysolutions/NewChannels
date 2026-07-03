#!/usr/bin/env python3.11
"""Fixture-based test for agents/validate.py.

Self-contained: synthesizes its own clips/stills/WAVs with ffmpeg in a temp dir,
asserts each check fires the right way, cleans up. No network, no committed
binaries. Run: python3.11 tests/test_validate.py  (exit 0 = all pass).
"""

import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agents"))
import validate as v  # noqa: E402

FAILS = []


def expect(label, got, want):
    ok = got == want
    if not ok:
        FAILS.append(label)
    print(f"[{'PASS' if ok else 'FAIL'}] {label}: {got} (want {want})")


def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def build_fixtures(d):
    ff("-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=6",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", f"{d}/good.mp4")
    ff("-f", "lavfi", "-i", "color=c=black:size=1920x1080:rate=30:duration=6",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", f"{d}/black.mp4")
    ff("-f", "lavfi", "-i", "testsrc=size=1920x1080:duration=1", "-frames:v", "1", f"{d}/good.png")
    # Mirrors real NB2 Lite output: 1376x768 JPEG, a ~16:9 aspect the model picks itself.
    ff("-f", "lavfi", "-i", "testsrc=size=1376x768:duration=1", "-frames:v", "1", f"{d}/nb2.jpg")
    ff("-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=16000", "-ac", "1", f"{d}/tone.wav")
    ff("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", f"{d}/silent.wav")


def run(d):
    import numpy as np

    # video: correct on all requested dimensions
    expect("good all-correct",
           v.check_video(f"{d}/good.mp4", expected_duration=6, expected_width=1920,
                         expected_height=1080, expected_codec="h264").ok, True)
    # video: black frames caught (TV-range black = luma 16)
    r = v.check_video(f"{d}/black.mp4", expected_width=1920, expected_height=1080)
    expect("black flagged", r.ok, False)
    expect("black -> black_frames check failed",
           next(c.ok for c in r.checks if c.name == "black_frames"), False)
    # video: each mismatch fails independently
    expect("wrong-res", v.check_video(f"{d}/good.mp4", expected_width=1280, expected_height=720).ok, False)
    expect("wrong-duration", v.check_video(f"{d}/good.mp4", expected_duration=30).ok, False)
    expect("wrong-codec", v.check_video(f"{d}/good.mp4", expected_codec="vp9").ok, False)
    # still
    expect("still good", v.check_still(f"{d}/good.png", expected_width=1920, expected_height=1080).ok, True)
    # aspect check: NB2's 1376x768 is ~16:9 and should pass an aspect request even though
    # it is not exactly 1920x1080 (this is why we validate aspect, not pixels, for NB2)
    expect("nb2 aspect 16:9 ok", v.check_still(f"{d}/nb2.jpg", expected_aspect="16:9").ok, True)
    # a 16:9 image must fail a 9:16 (portrait) aspect request
    expect("nb2 aspect 9:16 fails", v.check_still(f"{d}/nb2.jpg", expected_aspect="9:16").ok, False)
    # exact-pixel check still fails when the caller wrongly demands 1920x1080 of an NB2 still
    expect("nb2 exact-px mismatch fails", v.check_still(f"{d}/nb2.jpg", expected_width=1920, expected_height=1080).ok, False)
    # audio from disk
    expect("tone audio", v.check_audio(path=f"{d}/tone.wav").ok, True)
    expect("silent audio", v.check_audio(path=f"{d}/silent.wav").ok, False)
    # audio in-memory (the narrator's route)
    expect("in-memory silence", v.check_audio(samples=np.zeros(16000, dtype="float32"), sample_rate=16000).ok, False)
    expect("in-memory tone",
           v.check_audio(samples=(0.3 * np.sin(np.linspace(0, 600, 16000))).astype("float32"),
                         sample_rate=16000).ok, True)
    # audio clipping caught
    expect("in-memory clipping",
           v.check_audio(samples=np.ones(16000, dtype="float32"), sample_rate=16000).ok, False)
    # retry-once-then-alert: two bad attempts then raise
    calls = {"n": 0}

    def bad():
        calls["n"] += 1
        return np.zeros(10, dtype="float32")

    try:
        v.run_with_retry(bad, lambda s: v.check_audio(samples=s, sample_rate=16000), label="retrytest")
        expect("retry raises", False, True)
    except RuntimeError:
        expect("retry raises after exactly 2 attempts", calls["n"], 2)
    # retry-once-then-alert: recovers if 2nd attempt is good
    calls2 = {"n": 0}

    def flaky():
        calls2["n"] += 1
        return np.zeros(10, dtype="float32") if calls2["n"] == 1 else (0.3 * np.sin(np.linspace(0, 600, 16000))).astype("float32")

    _, rep = v.run_with_retry(flaky, lambda s: v.check_audio(samples=s, sample_rate=16000), label="flaky")
    expect("retry recovers on 2nd attempt", rep.ok and calls2["n"] == 2, True)
    # retry-once-then-alert also covers a produce() that RAISES (e.g. a failed video job):
    # two raising attempts -> RuntimeError after exactly 2 calls
    ecalls = {"n": 0}

    def always_raises():
        ecalls["n"] += 1
        raise RuntimeError("simulated job failure")

    try:
        v.run_with_retry(always_raises, lambda a: a, label="raiser")
        expect("produce-exception raises", False, True)
    except RuntimeError:
        expect("produce-exception raises after exactly 2 attempts", ecalls["n"], 2)
    # produce() raises once then succeeds -> recovers
    rcalls = {"n": 0}

    def raise_then_ok():
        rcalls["n"] += 1
        if rcalls["n"] == 1:
            raise RuntimeError("transient failure")
        return (0.3 * np.sin(np.linspace(0, 600, 16000))).astype("float32")

    _, rep2 = v.run_with_retry(raise_then_ok, lambda s: v.check_audio(samples=s, sample_rate=16000), label="transient")
    expect("recovers after produce() raised once", rep2.ok and rcalls["n"] == 2, True)
    # a validator that RAISES (a bug, not a transient failure) must propagate immediately,
    # WITHOUT re-running produce() — this is what stops a validator bug from re-spending on paid APIs
    vcalls = {"n": 0}

    def counting_produce():
        vcalls["n"] += 1
        return np.zeros(10, dtype="float32")

    def buggy_validate(_):
        raise TypeError("validator bug")

    try:
        v.run_with_retry(counting_produce, buggy_validate, label="valbug")
        expect("validator exception propagates", False, True)
    except TypeError:
        expect("validator exception does NOT re-run produce", vcalls["n"], 1)

    # check_video accepts expected_aspect (good.mp4 is 1920x1080 = exactly 16:9)
    expect("check_video aspect 16:9 ok", v.check_video(f"{d}/good.mp4", expected_aspect="16:9").ok, True)
    expect("check_video aspect 9:16 fails", v.check_video(f"{d}/good.mp4", expected_aspect="9:16").ok, False)


def main():
    with tempfile.TemporaryDirectory() as d:
        build_fixtures(d)
        run(d)
    print("\nRESULT:", "ALL PASS" if not FAILS else f"FAILURES: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())

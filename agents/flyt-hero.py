#!/usr/bin/env python3.11
"""flyt-hero.py - Session 2 (hero-shots stage).

Shared across both channels. Reads a scene manifest produced by
flyt-script-generator.js and renders one hero video clip per hero-scene using
Seedance 2.0 on Atlas Cloud.

Verified API facts (checked against Atlas Cloud docs 2026-07-03, not the doc,
which wrongly named BytePlus/ModelArk; the wired provider is Atlas Cloud):
  - provider Atlas Cloud, key ATLASCLOUD_API_KEY, ASYNC submit -> poll -> download
  - submit: POST https://api.atlascloud.ai/api/v1/model/generateVideo
      body: {model, prompt, resolution, aspect_ratio, duration, generate_audio}
      response: prediction id at data.id
  - poll:   GET https://api.atlascloud.ai/api/v1/model/prediction/{id}
      status "completed"/"failed"; output video URL at data.outputs[0]
  - model id: bytedance/seedance-2.0/text-to-video (fast tier: .../seedance-2.0-fast/text-to-video)
  - duration 4-15s (or -1 auto); we clamp the scene's target window into that range.

Only asset_type == "hero" scenes are rendered here (stills go through
flyt-stills.py). File numbering uses the scene's manifest index (scene_NN_hero.mp4)
so a hero clip lines up with its narration scene_NN.wav.

Usage:
  python3.11 agents/flyt-hero.py --channel channel_a --manifest ChannelA/manifests/<slug>.json
    [--model bytedance/seedance-2.0/text-to-video] [--resolution 1080p] [--aspect 16:9] [--dry-run]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

import alert  # Telegram alert callback for run_with_retry's "then-alert" half
import validate  # shared validation gate: check_video + run_with_retry

GENERATE_URL = "https://api.atlascloud.ai/api/v1/model/generateVideo"
PREDICTION_URL = "https://api.atlascloud.ai/api/v1/model/prediction/{pid}"
DEFAULT_MODEL = "bytedance/seedance-2.0/text-to-video"
DEFAULT_RESOLUTION = "1080p"
DEFAULT_ASPECT = "16:9"
SEEDANCE_MIN_DUR, SEEDANCE_MAX_DUR = 4, 15
POLL_INTERVAL = 5
POLL_TIMEOUT = 600
DURATION_TOL = 1.0  # video generators are less exact than a container; wider than stills/audio
TERMINAL_OK = {"completed", "succeeded"}
TERMINAL_FAIL = {"failed", "canceled", "cancelled", "error"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}
KEY_NAMES = ("NEWCHANNELS_ATLASCLOUD_API_KEY", "ATLASCLOUD_API_KEY")


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="flyt-hero.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    p.add_argument("--manifest", required=True, help="path to the scene manifest JSON (abs or repo-relative)")
    p.add_argument("--model", default=DEFAULT_MODEL, help="Seedance model id (use the -fast tier for cheap tests)")
    p.add_argument("--resolution", default=DEFAULT_RESOLUTION)
    p.add_argument("--aspect", default=DEFAULT_ASPECT)
    p.add_argument("--dry-run", action="store_true", help="validate + plan only; no API calls, no video written")
    return p.parse_args(argv)


def api_key():
    for name in KEY_NAMES:
        v = os.environ.get(name)
        if v and v.strip():
            return v.strip()
    env_path = os.path.expanduser("~/.openclaw/.env")
    if os.path.isfile(env_path):
        with open(env_path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, val = line.partition("=")
                if k.strip() in KEY_NAMES and val.strip():
                    return val.strip().strip('"').strip("'")
    raise RuntimeError(f"no Atlas Cloud key: set one of {KEY_NAMES} in the environment or ~/.openclaw/.env")


def resolve_manifest_path(manifest_arg):
    candidate = manifest_arg if os.path.isabs(manifest_arg) else os.path.join(ROOT, manifest_arg)
    if not os.path.isfile(candidate):
        raise FileNotFoundError(f"manifest not found: {candidate}")
    return candidate


def load_manifest(path, channel):
    """Return (manifest, hero_scenes) with each hero scene's original index and
    its target window duration. Fail fast at the boundary."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("manifest is not a JSON object")
    if data.get("channel") != channel:
        raise ValueError(f"manifest channel '{data.get('channel')}' does not match --channel '{channel}'")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("manifest.scenes must be a non-empty array")

    heroes = []
    for i, scene in enumerate(scenes):
        if scene.get("asset_type") != "hero":
            continue
        vp = scene.get("visual_prompt")
        if not isinstance(vp, str) or not vp.strip():
            raise ValueError(f"scene[{i}].visual_prompt must be a non-empty string")
        if not isinstance(scene.get("start"), (int, float)) or not isinstance(scene.get("end"), (int, float)):
            raise ValueError(f"scene[{i}].start and end must be numbers")
        heroes.append((i, scene))
    if not heroes:
        raise ValueError("manifest has no hero scenes to render")
    return data, heroes


def clamp_duration(target):
    """Seedance accepts 4-15s; clamp the scene's target window into that range."""
    return max(SEEDANCE_MIN_DUR, min(SEEDANCE_MAX_DUR, round(target)))


def _request(method, url, key, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    # Atlas is Cloudflare-fronted and blocks urllib's default UA with 403/1010,
    # so send a real User-Agent (verified: any non-default UA returns 200).
    headers = {"Authorization": f"Bearer {key}", "User-Agent": "flyt-hero/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Atlas API HTTP {exc.code}: {detail}")  # key is not echoed
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Atlas API unreachable: {exc.reason}")
    # Atlas wraps results as {code,msg,data:{...}}; tolerate a bare object too.
    return payload.get("data", payload)


def submit_job(prompt, *, model, resolution, aspect, duration, key):
    body = {
        "model": model,
        "prompt": prompt,
        "resolution": resolution,   # tier-specific: fast = 480p/720p/720p-SR/1080p-SR/1440p-SR
        "ratio": aspect,            # Atlas Seedance uses "ratio" (not "aspect_ratio"); "16:9", "9:16", "adaptive"...
        "duration": duration,
        "generate_audio": False,    # narration is our own local TTS track
    }
    data = _request("POST", GENERATE_URL, key, body)
    pid = data.get("id")
    if not pid:
        raise RuntimeError(f"submit returned no prediction id: {json.dumps(data)[:300]}")
    return pid


def poll_job(pid, *, key, interval=POLL_INTERVAL, timeout=POLL_TIMEOUT):
    deadline = time.time() + timeout
    while True:
        data = _request("GET", PREDICTION_URL.format(pid=pid), key)
        status = str(data.get("status", "")).lower()
        if status in TERMINAL_OK:
            outputs = data.get("outputs") or []
            if not outputs:
                raise RuntimeError(f"job {pid} completed but returned no outputs")
            return outputs[0]
        if status in TERMINAL_FAIL:
            raise RuntimeError(f"job {pid} failed (status={status}): {data.get('error') or data.get('message')}")
        if time.time() > deadline:
            raise RuntimeError(f"job {pid} timed out after {timeout}s (last status={status or 'unknown'})")
        time.sleep(interval)


def download(url, out_path):
    with urllib.request.urlopen(url, timeout=180) as resp, open(out_path, "wb") as fh:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            fh.write(chunk)


def render_scene_hero(scene, out_path, *, model, resolution, aspect, key):
    """Submit -> poll -> download, then validate (aspect + duration + 4-position
    black-frame). retry-once-then-alert (incl. failed jobs) lives in validate.py."""
    prompt = scene["visual_prompt"].strip()
    requested = clamp_duration(scene["end"] - scene["start"])

    def produce():
        pid = submit_job(prompt, model=model, resolution=resolution, aspect=aspect, duration=requested, key=key)
        info(f"  job {pid} submitted (duration={requested}s); polling...")
        url = poll_job(pid, key=key)
        download(url, out_path)
        return out_path

    _, report = validate.run_with_retry(
        produce,
        lambda p: validate.check_video(p, expected_aspect=aspect, expected_duration=requested,
                                       duration_tol_seconds=DURATION_TOL),
        label=f"hero {os.path.basename(out_path)}",
        alert=alert.make_alert(f"hero / {os.path.basename(out_path)}"),
    )
    return report, requested


def main(argv):
    args = parse_args(argv)
    manifest_path = resolve_manifest_path(args.manifest)
    manifest, heroes = load_manifest(manifest_path, args.channel)

    slug = os.path.splitext(os.path.basename(manifest_path))[0]
    channel_dir = os.path.join(ROOT, CHANNEL_DIRS[args.channel])
    out_dir = os.path.join(channel_dir, "tmp", slug)
    sidecar_path = os.path.join(channel_dir, "manifests", f"{slug}.hero.json")

    info(f"channel={args.channel} title=\"{manifest.get('title')}\" hero_scenes={len(heroes)} "
         f"model={args.model} {args.resolution} {args.aspect}")
    info(f"output dir: {out_dir}")

    if args.dry_run:
        for i, scene in heroes:
            dur = clamp_duration(scene["end"] - scene["start"])
            info(f"  scene {i:02d} dur={dur}s prompt: {scene['visual_prompt'].strip()[:80]}")
        info(f"[dry-run] {len(heroes)} hero scenes, no API calls, no video written")
        return 0

    key = api_key()
    os.makedirs(out_dir, exist_ok=True)

    assets = []
    run_start = time.time()
    for i, scene in heroes:
        mp4_path = os.path.join(out_dir, f"scene_{i:02d}_hero.mp4")
        t0 = time.time()
        report, requested = render_scene_hero(scene, mp4_path, model=args.model,
                                              resolution=args.resolution, aspect=args.aspect, key=key)
        dims = next((c.metrics for c in report.checks if c.name == "aspect"), {})
        dur_metric = next((c.metrics for c in report.checks if c.name == "duration"), {})
        w, h = dims.get("width"), dims.get("height")
        actual = dur_metric.get("duration")
        info(f"scene {i:02d}: {w}x{h} {actual}s mp4 in {time.time() - t0:.1f}s -> {os.path.relpath(mp4_path, ROOT)}")
        assets.append({
            "index": i,
            "mp4": os.path.relpath(mp4_path, ROOT),
            "width": w,
            "height": h,
            "aspect": args.aspect,
            "requested_duration_seconds": requested,
            "actual_duration_seconds": actual,
            "scene_target_seconds": round(scene["end"] - scene["start"], 3),
            "visual_prompt": scene["visual_prompt"],
        })

    sidecar = {
        "channel": args.channel,
        "title": manifest.get("title"),
        "source_manifest": os.path.relpath(manifest_path, ROOT),
        "model": args.model,
        "resolution": args.resolution,
        "aspect": args.aspect,
        "assets": assets,
    }
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
        fh.write("\n")

    info(f"[done] {len(assets)} hero clips in {time.time() - run_start:.1f}s -> {os.path.relpath(sidecar_path, ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

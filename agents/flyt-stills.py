#!/usr/bin/env python3.11
"""flyt-stills.py - Session 2 (stills stage).

Shared across both channels, parameterized by --channel. Reads a scene manifest
produced by flyt-script-generator.js and renders one still image per still-scene
using Nano Banana 2 Lite (Gemini `gemini-3.1-flash-lite-image`).

Verified API facts (checked against the live endpoint 2026-07-03, not the doc):
  - model gemini-3.1-flash-lite-image, endpoint :generateContent, SYNCHRONOUS
    (inline base64 response, no submit/poll/complete job loop)
  - request: contents[].parts[].text + generationConfig.responseModalities:["IMAGE"]
    + generationConfig.imageConfig.aspectRatio
  - response: candidates[0].content.parts[].inlineData.{mimeType,data} -> base64 JPEG
  - a "16:9" request returns ~1376x768 (the model picks the pixels), so validation
    checks ASPECT RATIO, not exact pixels. Assembly scales up.

Hero-scene visuals are handled by the Seedance wrapper, not here; this stage only
renders asset_type == "still" scenes. File numbering uses the scene's index in the
full manifest (scene_NN.jpg), so a still lines up with its narration scene_NN.wav.

Usage:
  python3.11 agents/flyt-stills.py --channel channel_a --manifest ChannelA/manifests/<slug>.json [--aspect 16:9]
  python3.11 agents/flyt-stills.py --channel channel_a --manifest <path> --dry-run
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

import validate  # shared validation gate (same agents/ dir): check_still + run_with_retry

MODEL = "gemini-3.1-flash-lite-image"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
DEFAULT_ASPECT = "16:9"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}
KEY_NAMES = ("NEWCHANNELS_GEMINI_API_KEY", "GEMINI_API_KEY")


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="flyt-stills.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    p.add_argument("--manifest", required=True, help="path to the scene manifest JSON (abs or repo-relative)")
    p.add_argument("--aspect", default=DEFAULT_ASPECT, help="aspect ratio requested from NB2 (default 16:9)")
    p.add_argument("--style", default=None, help="optional style suffix appended to each visual_prompt")
    p.add_argument("--dry-run", action="store_true", help="validate + plan only; no API calls, no image written")
    return p.parse_args(argv)


def api_key():
    """NB2 key from env (NEWCHANNELS_GEMINI_API_KEY wins), falling back to
    ~/.openclaw/.env to match the JS lib's precedence. Fail fast if unset."""
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
    raise RuntimeError(f"no Gemini API key: set one of {KEY_NAMES} in the environment or ~/.openclaw/.env")


def resolve_manifest_path(manifest_arg):
    candidate = manifest_arg if os.path.isabs(manifest_arg) else os.path.join(ROOT, manifest_arg)
    if not os.path.isfile(candidate):
        raise FileNotFoundError(f"manifest not found: {candidate}")
    return candidate


def load_manifest(path, channel):
    """Read + validate the manifest; return (manifest, still_scenes) where each
    still scene carries its original manifest index. Fail fast at the boundary."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("manifest is not a JSON object")
    if data.get("channel") != channel:
        raise ValueError(f"manifest channel '{data.get('channel')}' does not match --channel '{channel}'")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("manifest.scenes must be a non-empty array")

    stills = []
    for i, scene in enumerate(scenes):
        if scene.get("asset_type") != "still":
            continue
        vp = scene.get("visual_prompt")
        if not isinstance(vp, str) or not vp.strip():
            raise ValueError(f"scene[{i}].visual_prompt must be a non-empty string")
        stills.append((i, scene))
    if not stills:
        raise ValueError("manifest has no still scenes to render")
    return data, stills


def build_prompt(scene, style_suffix=None):
    """Prompt = scene.visual_prompt (+ optional style suffix). Full STYLE_GUIDE
    blending is deferred until the per-channel visual spec is locked (Section 08)."""
    prompt = scene["visual_prompt"].strip()
    if style_suffix:
        prompt = f"{prompt}. {style_suffix.strip()}"
    return prompt


def generate_still(prompt, aspect, key):
    """POST a synchronous NB2 generateContent request; return decoded JPEG bytes.
    Raises on HTTP error, API error, safety block, or a missing image part."""
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{API_URL}?key={key}", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"NB2 API HTTP {exc.code}: {detail}")  # key is not echoed
    except urllib.error.URLError as exc:
        raise RuntimeError(f"NB2 API unreachable: {exc.reason}")

    candidates = payload.get("candidates")
    if not candidates:
        raise RuntimeError(f"NB2 returned no candidates: {json.dumps(payload)[:300]}")
    for part in candidates[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            return base64.b64decode(part["inlineData"]["data"])
    raise RuntimeError(f"NB2 returned no image part (finishReason={candidates[0].get('finishReason')})")


def render_scene_still(scene, out_path, *, aspect, key, style):
    """Generate + validate one still with retry-once-then-alert (validate.py owns
    the discipline). Returns the validate Report."""
    prompt = build_prompt(scene, style)

    def produce():
        img = generate_still(prompt, aspect, key)
        with open(out_path, "wb") as fh:
            fh.write(img)
        return out_path

    _, report = validate.run_with_retry(
        produce,
        lambda p: validate.check_still(p, expected_aspect=aspect),
        label=f"still {os.path.basename(out_path)}",
    )
    return report


def main(argv):
    args = parse_args(argv)
    manifest_path = resolve_manifest_path(args.manifest)
    manifest, stills = load_manifest(manifest_path, args.channel)

    slug = os.path.splitext(os.path.basename(manifest_path))[0]
    channel_dir = os.path.join(ROOT, CHANNEL_DIRS[args.channel])
    out_dir = os.path.join(channel_dir, "tmp", slug)
    sidecar_path = os.path.join(channel_dir, "manifests", f"{slug}.stills.json")

    info(f"channel={args.channel} title=\"{manifest.get('title')}\" still_scenes={len(stills)} aspect={args.aspect}")
    info(f"output dir: {out_dir}")

    if args.dry_run:
        total_chars = sum(len(s["visual_prompt"]) for _, s in stills)
        info(f"[dry-run] {len(stills)} still scenes, {total_chars} prompt chars, no API calls, no images written")
        for i, scene in stills:
            info(f"  scene {i:02d} prompt: {build_prompt(scene, args.style)[:90]}")
        return 0

    key = api_key()
    os.makedirs(out_dir, exist_ok=True)

    assets = []
    run_start = time.time()
    for i, scene in stills:
        jpg_path = os.path.join(out_dir, f"scene_{i:02d}.jpg")
        t0 = time.time()
        report = render_scene_still(scene, jpg_path, aspect=args.aspect, key=key, style=args.style)
        dims = next((c.metrics for c in report.checks if c.name == "aspect"), {})
        w, h = dims.get("width"), dims.get("height")
        info(f"scene {i:02d}: {w}x{h} jpg in {time.time() - t0:.1f}s -> {os.path.relpath(jpg_path, ROOT)}")
        assets.append({
            "index": i,
            "jpg": os.path.relpath(jpg_path, ROOT),
            "width": w,
            "height": h,
            "aspect": args.aspect,
            "visual_prompt": scene["visual_prompt"],
        })

    sidecar = {
        "channel": args.channel,
        "title": manifest.get("title"),
        "source_manifest": os.path.relpath(manifest_path, ROOT),
        "model": MODEL,
        "aspect": args.aspect,
        "assets": assets,
    }
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
        fh.write("\n")

    info(f"[done] {len(assets)} stills in {time.time() - run_start:.1f}s -> {os.path.relpath(sidecar_path, ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - top-level guard, report and exit nonzero
        sys.stderr.write(f"[error] {exc}\n")
        raise SystemExit(1)

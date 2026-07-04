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

import alert  # Telegram alert callback for run_with_retry's "then-alert" half
import validate  # shared validation gate (same agents/ dir): check_still + run_with_retry

MODEL = "gemini-3.1-flash-lite-image"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
# Batch API (Channel A async stills, 50% cost): submit many requests, poll, collect.
BATCH_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchGenerateContent"
DEFAULT_ASPECT = "16:9"
# Batch job states (v1beta). SUCCEEDED = ready to collect; PENDING/RUNNING = wait.
BATCH_DONE = "JOB_STATE_SUCCEEDED"
BATCH_FAIL = {"JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}
KEY_NAMES = ("NEWCHANNELS_GEMINI_API_KEY", "GEMINI_API_KEY")

# Locked per-channel visual identity, appended to every still's visual_prompt when
# no explicit --style override is given. This is what keeps the look CONSISTENT
# across videos (the human source of truth is ChannelX/STYLE_GUIDE.md, Section 08).
# Channel A confirmed against the Zenn reference channel: minimalist stick-figure
# characters + flat backgrounds, NOT photorealistic.
CHANNEL_STYLE = {
    "channel_a": (
        "Art style: simple 2D stick-figure vector illustration. Every character has a plain "
        "circular head, small dot eyes, and thin line-drawn limbs with minimal detail — "
        "deliberately minimalist, NOT photorealistic and NOT fully-rendered animation. Keep the "
        "same character proportions and features in every scene for a consistent, recognizable "
        "identity. Backgrounds are flat solid colors with at most one simple prop or scenery "
        "silhouette (a tree, a cave, terrain), never detailed or photoreal environments."
    ),
    # Channel B's visual identity is not locked yet (see ChannelB/STYLE_GUIDE.md TBDs).
    "channel_b": None,
}

# Sentinel for a scene's `style` render-block field (Section 07/08). A scene
# normally carries style="channel_default", meaning "use CHANNEL_STYLE for this
# channel"; any other non-empty value is a deliberate per-scene art-style override.
# Must match STYLE_DEFAULT in agents/lib/manifest.js.
STYLE_DEFAULT = "channel_default"


def info(msg):
    sys.stdout.write(f"[info] {msg}\n")
    sys.stdout.flush()


def parse_args(argv):
    p = argparse.ArgumentParser(prog="flyt-stills.py", add_help=True)
    p.add_argument("--channel", required=True, choices=list(CHANNEL_DIRS.keys()))
    # Synchronous mode (Channel B / per-scene) uses --manifest; async batch mode
    # (Channel A shots) uses --shots. Exactly one is required, validated in main().
    p.add_argument("--manifest", help="path to the scene manifest JSON (synchronous per-scene mode)")
    p.add_argument("--shots", help="path to the <slug>.shots.json (batch mode: one still per shot window)")
    p.add_argument("--batch-submit", action="store_true", help="submit a Gemini Batch job for the shots and print its job name")
    p.add_argument("--batch-collect", action="store_true", help="collect a finished Batch job's images (needs --job)")
    p.add_argument("--job", help="batch job name (batches/...) to collect")
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


def build_prompt(scene, channel, style_override=None):
    """Assemble the still prompt from: scene.visual_prompt, the render-block
    descriptors (era/location/subject_type, Section 07/08 — the period/setting
    accuracy guard against era drift), and the resolved art style.

    Style resolution, in priority order:
      1. an explicit --style CLI override (one-off experiments);
      2. a per-scene deliberate override (scene.style is set and != STYLE_DEFAULT);
      3. otherwise the channel's locked CHANNEL_STYLE.
    Scenes normally carry style="channel_default", so the look stays consistent
    without re-specifying it per scene. Missing render fields degrade gracefully
    here (manifest.js is the strict gate); a channel with no locked style adds
    nothing."""
    parts = [scene["visual_prompt"].strip()]

    # Render block anchors era/location/subject so period accuracy no longer relies
    # on the prose alone to convey "ancient" vs "modern" (the drift guard). Tokens
    # are humanized (period_people -> "period people") for the image model.
    render = scene.get("render") or {}
    descriptors = []
    for label, field in (("Era", "era"), ("Location", "location"), ("Subject", "subject_type")):
        val = render.get(field)
        if isinstance(val, str) and val.strip():
            descriptors.append(f"{label}: {val.strip().replace('_', ' ')}")
    if descriptors:
        parts.append(". ".join(descriptors))

    # Art style is governed by the channel-level CHANNEL_STYLE. render.style is only
    # a scene-level override (rare); an explicit --style CLI flag still wins over all.
    scene_style = render.get("style")
    if style_override:
        style = style_override
    elif isinstance(scene_style, str) and scene_style.strip() and scene_style.strip() != STYLE_DEFAULT:
        style = scene_style.strip()
    else:
        style = CHANNEL_STYLE.get(channel)
    if style:
        parts.append(style.strip())

    return ". ".join(p for p in parts if p)


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


def render_scene_still(scene, out_path, *, channel, aspect, key, style):
    """Generate + validate one still with retry-once-then-alert (validate.py owns
    the discipline). Returns the validate Report."""
    prompt = build_prompt(scene, channel, style)

    def produce():
        img = generate_still(prompt, aspect, key)
        with open(out_path, "wb") as fh:
            fh.write(img)
        return out_path

    _, report = validate.run_with_retry(
        produce,
        lambda p: validate.check_still(p, expected_aspect=aspect),
        label=f"still {os.path.basename(out_path)}",
        alert=alert.make_alert(f"stills / {os.path.basename(out_path)}"),
    )
    return report


# ---- Batch mode (Channel A async stills) -------------------------------------
def load_shots(path, channel):
    """Read + validate a <slug>.shots.json: one still per shot window. Each shot
    carries its visual_prompt (already vpcheck-cleaned) and, inherited from its
    beat, a render block so build_prompt can apply era/setting + CHANNEL_STYLE."""
    candidate = path if os.path.isabs(path) else os.path.join(ROOT, path)
    if not os.path.isfile(candidate):
        raise FileNotFoundError(f"shots file not found: {candidate}")
    with open(candidate, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("channel") != channel:
        raise ValueError(f"shots channel '{data.get('channel')}' does not match --channel '{channel}'")
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("shots.shots must be a non-empty array")
    for s in shots:
        if not isinstance(s.get("shot_index"), int):
            raise ValueError(f"shot missing integer shot_index: {json.dumps(s)[:120]}")
        if not isinstance(s.get("visual_prompt"), str) or not s["visual_prompt"].strip():
            raise ValueError(f"shot {s.get('shot_index')} has empty visual_prompt")
    return data, shots


def build_batch_requests(shots, channel, aspect, style):
    """One inline batch request per shot. metadata.key = the shot_index (as a
    string) so collected results map back unambiguously to their shot."""
    requests = []
    for s in shots:
        prompt = build_prompt(s, channel, style)  # shot dict has visual_prompt (+ render)
        requests.append({
            "request": {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}},
            },
            "metadata": {"key": str(s["shot_index"])},
        })
    return requests


def _batch_http(method, url, key, body=None, timeout=120):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Batch API HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Batch API unreachable: {exc.reason}")


def submit_batch(requests, key, display_name):
    body = {"batch": {"display_name": display_name,
                      "input_config": {"requests": {"requests": requests}}}}
    op = _batch_http("POST", BATCH_URL, key, body)
    name = op.get("name")
    if not name:
        raise RuntimeError(f"batch submit returned no job name: {json.dumps(op)[:300]}")
    return name


def batch_state(op):
    """Job state lives in metadata.state (long-running operation); tolerate a
    top-level state too."""
    meta = op.get("metadata") or {}
    return meta.get("state") or op.get("state")


def extract_batch_images(op):
    """Map shot_index (int) -> JPEG bytes from a SUCCEEDED batch operation. Reads
    the inline responses; each carries back its metadata.key. Defensive about the
    exact nesting (inlinedResponses may sit under response or metadata)."""
    resp = op.get("response") or {}
    ir = resp.get("inlinedResponses")
    if isinstance(ir, dict):          # nested: {"inlinedResponses": {"inlinedResponses": [...]}}
        inlined = ir.get("inlinedResponses") or []
    elif isinstance(ir, list):        # flat: {"inlinedResponses": [...]}
        inlined = ir
    else:
        inlined = []
    out = {}
    for item in inlined:
        key = (item.get("metadata") or {}).get("key")
        gen = item.get("response") or {}
        cands = gen.get("candidates") or []
        if key is None or not cands:
            continue
        for part in cands[0].get("content", {}).get("parts", []):
            if "inlineData" in part:
                out[int(key)] = base64.b64decode(part["inlineData"]["data"])
                break
    return out


def run_batch_submit(args):
    data, shots = load_shots(args.shots, args.channel)
    slug = data.get("slug") or os.path.splitext(os.path.basename(args.shots))[0].replace(".shots", "")
    requests = build_batch_requests(shots, args.channel, args.aspect, args.style)
    info(f"channel={args.channel} slug=\"{slug}\" shots={len(shots)} aspect={args.aspect} (batch submit)")
    if args.dry_run:
        body = {"batch": {"display_name": slug, "input_config": {"requests": {"requests": requests}}}}
        size = len(json.dumps(body).encode("utf-8"))
        info(f"[dry-run] built {len(requests)} inline batch requests, body {size} bytes, no submit")
        info(f"  sample request[0]: {json.dumps(requests[0])[:220]}")
        info(f"  keys: {', '.join(r['metadata']['key'] for r in requests[:6])}{' ...' if len(requests) > 6 else ''}")
        return 0
    key = api_key()
    name = submit_batch(requests, key, slug)
    info(f"[submitted] {len(requests)} requests -> batch job {name}")
    # Machine-readable line the orchestrator parses to persist videos.batch_job_id.
    sys.stdout.write(f"BATCH_JOB={name}\n")
    sys.stdout.flush()
    return 0


def run_batch_collect(args):
    if not args.job:
        raise ValueError("--batch-collect requires --job <batches/...>")
    data, shots = load_shots(args.shots, args.channel)
    slug = data.get("slug") or os.path.splitext(os.path.basename(args.shots))[0].replace(".shots", "")
    key = api_key()
    op = _batch_http("GET", f"https://generativelanguage.googleapis.com/v1beta/{args.job}", key)
    state = batch_state(op)
    info(f"batch {args.job} state={state}")
    if state != BATCH_DONE:
        if state in BATCH_FAIL:
            raise RuntimeError(f"batch job {args.job} ended in {state}")
        info("[pending] not ready yet; nothing collected")
        return 2  # distinct 'not ready' signal for the poller

    images = extract_batch_images(op)
    if not images:
        raise RuntimeError("batch SUCCEEDED but no images could be extracted (result shape?)")

    channel_dir = os.path.join(ROOT, CHANNEL_DIRS[args.channel])
    out_dir = os.path.join(channel_dir, "tmp", slug)
    os.makedirs(out_dir, exist_ok=True)
    sidecar_path = os.path.join(channel_dir, "manifests", f"{slug}.stills.json")

    assets = []
    missing = []
    for s in shots:
        idx = s["shot_index"]
        if idx not in images:
            missing.append(idx)
            continue
        jpg_path = os.path.join(out_dir, f"shot_{idx:03d}.jpg")
        with open(jpg_path, "wb") as fh:
            fh.write(images[idx])
        # Cheap deterministic validation now (decode/aspect/black); the vision QA
        # (step 8) is a separate later pass.
        try:
            report = validate.check_still(jpg_path, expected_aspect=args.aspect)
            dims = next((c.metrics for c in report.checks if c.name == "aspect"), {})
            valid = report.ok
            w, h = dims.get("width"), dims.get("height")
        except Exception as exc:  # noqa: BLE001 - record, do not abort the whole collect
            valid, w, h = False, None, None
            info(f"  shot {idx:03d}: validation error: {exc}")
        assets.append({"shot_index": idx, "jpg": os.path.relpath(jpg_path, ROOT),
                       "width": w, "height": h, "aspect": args.aspect,
                       "valid": valid, "visual_prompt": s["visual_prompt"]})

    sidecar = {"channel": args.channel, "title": data.get("title"), "slug": slug,
               "source_shots": os.path.relpath(args.shots if os.path.isabs(args.shots)
                                                else os.path.join(ROOT, args.shots), ROOT),
               "model": MODEL, "aspect": args.aspect, "assets": assets}
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
        fh.write("\n")
    info(f"[done] collected {len(assets)}/{len(shots)} shots"
         + (f", MISSING {missing}" if missing else "")
         + f" -> {os.path.relpath(sidecar_path, ROOT)}")
    if missing:
        raise RuntimeError(f"batch collect incomplete: {len(missing)} shot(s) missing images: {missing}")
    return 0


def main(argv):
    args = parse_args(argv)

    # Mode dispatch: batch submit / collect (Channel A async) vs synchronous.
    if args.batch_submit or args.batch_collect:
        if not args.shots:
            raise ValueError("batch mode requires --shots <path>")
        return run_batch_submit(args) if args.batch_submit else run_batch_collect(args)

    if not args.manifest:
        raise ValueError("synchronous mode requires --manifest (or use --batch-submit/--batch-collect with --shots)")
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
            info(f"  scene {i:02d} prompt: {build_prompt(scene, args.channel, args.style)[:90]}")
        return 0

    key = api_key()
    os.makedirs(out_dir, exist_ok=True)

    assets = []
    run_start = time.time()
    for i, scene in stills:
        jpg_path = os.path.join(out_dir, f"scene_{i:02d}.jpg")
        t0 = time.time()
        report = render_scene_still(scene, jpg_path, channel=args.channel, aspect=args.aspect, key=key, style=args.style)
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

"""Image-generation provider abstraction (registry: config/image-models.json).

flyt-stills.py stays provider-agnostic: it assembles prompts and owns the batch
FLOW, validation, sidecar writing, and exit codes. Everything provider-specific
(endpoint, request body shape, response parsing, batch submit/poll/collect, auth)
lives in an adapter selected by config. Swapping image models is a config change
(ChannelX/config.json "image_model"), not a code edit.

Registry entry -> adapter class is chosen by the entry's "adapter" field.
Per-channel model selection: ChannelX/config.json {"image_model": "..."} with a
fallback to DEFAULT_IMAGE_MODEL, so a channel with no config.json keeps today's
behavior exactly.
"""

import base64
import json
import os
import time
import urllib.error
import urllib.request

# image_providers.py lives in agents/lib/, so ROOT is three levels up.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGISTRY_PATH = os.path.join(ROOT, "config", "image-models.json")
CHANNEL_DIRS = {"channel_a": "ChannelA", "channel_b": "ChannelB"}
DEFAULT_IMAGE_MODEL = "gemini-nb2-batch"


def _load_registry():
    with open(REGISTRY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def resolve_image_model(channel):
    """Which image model this channel uses. Reads ChannelX/config.json
    'image_model'; falls back to DEFAULT_IMAGE_MODEL when the file or key is
    absent or unreadable, so a channel with no config.json keeps today's
    behavior (Channel A's live path is unchanged)."""
    cfg_path = os.path.join(ROOT, CHANNEL_DIRS.get(channel, ""), "config.json")
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            model = cfg.get("image_model")
            if isinstance(model, str) and model.strip():
                return model.strip()
        except (ValueError, OSError):
            pass
    return DEFAULT_IMAGE_MODEL


def get_adapter(model_id=None, channel=None):
    """Return the adapter for an explicit model_id, or the one this channel is
    configured to use."""
    if model_id is None:
        model_id = resolve_image_model(channel)
    spec = _load_registry().get(model_id)
    if not spec:
        raise RuntimeError(f"image model '{model_id}' not in {REGISTRY_PATH}")
    cls = _ADAPTERS.get(spec.get("adapter"))
    if not cls:
        raise RuntimeError(f"no adapter class for '{spec.get('adapter')}' (model {model_id})")
    return cls(model_id, spec)


class ImageAdapter:
    """Common interface every provider implements. Prompt assembly stays in the
    caller; adapters take finished prompt text and own the API surface."""

    def __init__(self, model_id, spec):
        self.model_id = model_id
        self.spec = spec

    @property
    def model_name(self):
        return self.spec.get("model", self.model_id)

    @property
    def supports_batch(self):
        return bool(self.spec.get("supports_batch"))

    @property
    def cost_per_image_usd(self):
        return float(self.spec.get("cost_per_image_usd", 0.0))

    def api_key(self):
        """Key from env (registry auth_env order wins), falling back to
        ~/.openclaw/.env to match the JS lib precedence. Fail fast if unset."""
        names = self.spec.get("auth_env") or []
        for name in names:
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
                    if k.strip() in names and val.strip():
                        return val.strip().strip('"').strip("'")
        raise RuntimeError(f"no API key for {self.model_id}: set one of {names} in env or ~/.openclaw/.env")

    def _endpoint(self, name, **kw):
        tmpl = (self.spec.get("endpoints") or {}).get(name)
        if not tmpl:
            raise RuntimeError(f"model {self.model_id} has no '{name}' endpoint")
        return tmpl.format(model=self.model_name, **kw)

    # ---- sync single-image (Channel B / per-scene) ----
    def generate_still(self, prompt, aspect):
        raise NotImplementedError

    # ---- batch (Channel A async) ----
    def build_batch_requests(self, items, aspect):
        raise NotImplementedError

    def batch_submit_body(self, requests, display_name):
        raise NotImplementedError

    def submit_batch(self, requests, display_name):
        raise NotImplementedError

    def poll_batch(self, job):
        raise NotImplementedError

    def batch_state(self, op):
        raise NotImplementedError

    def is_done(self, state):
        raise NotImplementedError

    def is_failed(self, state):
        raise NotImplementedError

    def collect_images(self, op):
        raise NotImplementedError


class GeminiImageAdapter(ImageAdapter):
    """Nano Banana 2 Lite via Gemini generativelanguage API. Sync generateContent
    (inline base64) + batchGenerateContent (inline requests). Logic moved verbatim
    from flyt-stills.py; verified against the live endpoint 2026-07-03."""

    def _request_body(self, prompt, aspect):
        return {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}},
        }

    def _batch_http(self, method, url, body=None, timeout=120):
        key = self.api_key()
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

    def generate_still(self, prompt, aspect):
        key = self.api_key()
        body = json.dumps(self._request_body(prompt, aspect)).encode("utf-8")
        req = urllib.request.Request(
            f"{self._endpoint('sync')}?key={key}", data=body,
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

    def build_batch_requests(self, items, aspect):
        """One inline batch request per (key, prompt). metadata.key = the shot_index
        as a string so collected results map back unambiguously."""
        requests = []
        for key, prompt in items:
            requests.append({
                "request": self._request_body(prompt, aspect),
                "metadata": {"key": str(key)},
            })
        return requests

    def batch_submit_body(self, requests, display_name):
        return {"batch": {"display_name": display_name,
                          "input_config": {"requests": {"requests": requests}}}}

    def submit_batch(self, requests, display_name):
        op = self._batch_http("POST", self._endpoint("batch_submit"),
                              self.batch_submit_body(requests, display_name))
        name = op.get("name")
        if not name:
            raise RuntimeError(f"batch submit returned no job name: {json.dumps(op)[:300]}")
        return name

    def poll_batch(self, job):
        return self._batch_http("GET", self._endpoint("batch_status", job=job))

    def batch_state(self, op):
        meta = op.get("metadata") or {}
        return meta.get("state") or op.get("state")

    def is_done(self, state):
        return state == (self.spec.get("batch") or {}).get("done")

    def is_failed(self, state):
        return state in set((self.spec.get("batch") or {}).get("failed") or [])

    def collect_images(self, op):
        """Map shot_index (int) -> JPEG bytes from a SUCCEEDED batch operation.
        Defensive about the exact nesting (inlinedResponses may be nested or flat)."""
        resp = op.get("response") or {}
        ir = resp.get("inlinedResponses")
        if isinstance(ir, dict):
            inlined = ir.get("inlinedResponses") or []
        elif isinstance(ir, list):
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


class OpenAIImagesAdapter(ImageAdapter):
    """STUB for GPT Image 2 (OpenAI images API). Synchronous only, no batch.
    Fill in the request build + b64_json parse when this provider is wired.
    supports_batch is false in the registry, so the batch path never reaches here."""

    def generate_still(self, prompt, aspect):
        raise NotImplementedError("OpenAIImagesAdapter.generate_still is a stub, not wired yet")


class AtlasGenerateAdapter(ImageAdapter):
    """GPT Image 2 via Atlas Cloud's standard route (openai/gpt-image-2/text-to-image).
    Async generateImage-then-poll: POST /generateImage returns a polling handle,
    GET /prediction/{id} until status=completed, image is a URL in outputs[0]
    (PNG) which we download. Distinct route from the openai-direct stub; verified
    against the live API 2026-07-05. supports_batch is false, so only the sync
    per-scene path uses it."""

    POLL_INTERVAL_S = 3
    POLL_TIMEOUT_S = 180
    # Atlas sits behind Cloudflare, which bans urllib's default User-Agent
    # (403 error 1010). A normal UA clears the edge WAF.
    USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NewChannels-flyt/1.0"

    @property
    def quality(self):
        return self.spec.get("quality", "low")

    def _size_for(self, aspect):
        by = self.spec.get("size_by_aspect") or {}
        return by.get(aspect, self.spec.get("default_size", "1024x1024"))

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.api_key()}",
            "Content-Type": "application/json",
            "User-Agent": self.USER_AGENT,
        }

    def _http(self, method, url, body=None, timeout=60):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Atlas API HTTP {exc.code}: {detail}")  # key is not echoed
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Atlas API unreachable: {exc.reason}")

    @staticmethod
    def _dig(payload, *keys):
        """Pull the first present key from payload or a nested 'data' object,
        so we tolerate either {k:..} or {data:{k:..}} response nesting."""
        for src in (payload, payload.get("data") if isinstance(payload.get("data"), dict) else None):
            if not isinstance(src, dict):
                continue
            for k in keys:
                if src.get(k) not in (None, ""):
                    return src[k]
        return None

    def _poll_url(self, submit_resp):
        """The polling target: an explicit URL if the submit response gives one,
        else built from a returned id + the prediction endpoint template."""
        urls = self._dig(submit_resp, "urls")
        if isinstance(urls, dict) and urls.get("get"):
            return urls["get"]
        pid = self._dig(submit_resp, "id", "request_id", "prediction_id")
        if not pid:
            raise RuntimeError(f"Atlas submit returned no id/polling url: {json.dumps(submit_resp)[:300]}")
        return self._endpoint("prediction", id=pid)

    def _download(self, url):
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": self.USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Atlas image download failed: {exc}")

    def generate_still(self, prompt, aspect):
        body = {
            "model": self.model_name,
            "prompt": prompt,
            "size": self._size_for(aspect),
            "quality": self.quality,
        }
        submit = self._http("POST", self._endpoint("generate"), body)
        poll_url = self._poll_url(submit)

        deadline = time.time() + self.POLL_TIMEOUT_S
        while True:
            op = self._http("GET", poll_url)
            status = self._dig(op, "status")
            if status == "completed":
                outputs = self._dig(op, "outputs", "output") or []
                if not outputs:
                    raise RuntimeError(f"Atlas completed with no outputs: {json.dumps(op)[:300]}")
                return self._download(outputs[0])
            if status == "failed":
                raise RuntimeError(f"Atlas prediction failed: {json.dumps(op)[:300]}")
            if time.time() > deadline:
                raise RuntimeError(f"Atlas prediction timed out after {self.POLL_TIMEOUT_S}s (last status={status})")
            time.sleep(self.POLL_INTERVAL_S)


_ADAPTERS = {
    "gemini": GeminiImageAdapter,
    "openai_images": OpenAIImagesAdapter,
    "atlas_generate": AtlasGenerateAdapter,
}

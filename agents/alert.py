#!/usr/bin/env python3.11
"""alert.py - the "then-alert" half of retry-once-then-alert (Section 03 step 6).

validate.run_with_retry accepts an alert= callback and calls it once, with the
failing Report, when an asset fails validation even after its single retry. Until
now every call site omitted that callback, so a post-retry failure on an
unattended run died silently to stderr. This module supplies the callback: a
best-effort Telegram message via FlytBot.

Design rules:
  - NEVER raises. An alert-send failure must not mask the real generation failure
    that triggered it; it degrades to a stderr line.
  - stdlib only (urllib), same as the other Python agents. No new dependency.
  - Credentials come from the environment first, then ~/.openclaw/.env, matching
    the key-resolution precedence flyt-stills.py already uses.
"""

import json
import os
import sys
import urllib.request

FLYT_TOKEN_KEYS = ("FLYT_BOT_TOKEN",)
FLYT_CHAT_KEYS = ("FLYT_CHAT_ID",)


def _env(names):
    """First matching key from the environment, then ~/.openclaw/.env. None if unset."""
    for n in names:
        v = os.environ.get(n)
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
    return None


def _fail_lines(report):
    """Human-readable list of the checks that failed on a validate.Report."""
    lines = [f"{c.name}: {c.detail}" for c in getattr(report, "checks", ()) if not c.ok]
    return lines or ["(no per-check detail available)"]


def send(text):
    """Best-effort Telegram sendMessage. Returns True on send, False otherwise.
    Never raises: a missing token/chat or a network error becomes a stderr line.
    Set ALERT_DRYRUN=1 to print the message instead of posting (used for tests)."""
    if os.environ.get("ALERT_DRYRUN", "").strip():
        sys.stderr.write(f"[alert][dry-run] would send:\n{text}\n")
        return True
    token = _env(FLYT_TOKEN_KEYS)
    chat = _env(FLYT_CHAT_KEYS)
    if not token or not chat:
        sys.stderr.write("[alert] FLYT_BOT_TOKEN/FLYT_CHAT_ID not set; cannot send Telegram alert\n")
        return False
    body = json.dumps({"chat_id": chat, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        return True
    except Exception as exc:  # noqa: BLE001 - alert must never mask the original error
        sys.stderr.write(f"[alert] Telegram alert send failed: {exc}\n")
        return False


def make_alert(label):
    """Build the alert callback for validate.run_with_retry(alert=...). It fires
    only on a validation failure that survived the one retry, and reports which
    stage, which asset, and which checks failed."""
    def _alert(report):
        path = getattr(report, "path", "?")
        detail = "\n".join(f"  - {line}" for line in _fail_lines(report))
        text = (
            "🚨 New Channels pipeline: validation failed after retry\n"
            f"stage: {label}\n"
            f"asset: {path}\n"
            f"failed checks:\n{detail}"
        )
        send(text)

    return _alert


if __name__ == "__main__":
    # CLI: `python3.11 agents/alert.py "<message>"` — lets the JS orchestrator fire
    # the same alert channel as the Python agents instead of duplicating it. Reads
    # the message from argv (or stdin if none). Always exits 0: the caller is
    # already handling a failure and the alert must not change its exit semantics.
    _msg = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else sys.stdin.read()
    if _msg.strip():
        send(_msg)
    raise SystemExit(0)

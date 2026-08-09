from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode


BASE_URL = os.environ.get("DOLPHINSCHEDULER_BASE_URL", "").rstrip("/")
TOKEN_FILE = Path(os.environ.get("DOLPHINSCHEDULER_TOKEN_FILE", "/run/secrets/dolphinscheduler-token.json"))
USER_ID = int(os.environ.get("DOLPHINSCHEDULER_TOKEN_USER_ID", "0"))
TTL_DAYS = int(os.environ.get("DOLPHINSCHEDULER_TOKEN_TTL_DAYS", "7"))
ROTATE_HOURS = int(os.environ.get("DOLPHINSCHEDULER_TOKEN_ROTATE_HOURS", "24"))
OVERLAP_MINUTES = int(os.environ.get("DOLPHINSCHEDULER_TOKEN_OVERLAP_MINUTES", "30"))
CREATE_PATH = os.environ.get("DOLPHINSCHEDULER_TOKEN_CREATE_PATH", "/access-tokens")


def _request(path: str, token: str, method: str, body: dict | None = None) -> dict:
    payload = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE_URL + path, data=payload, method=method,
                                     headers={"Content-Type": "application/json", "token": token})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode())


def _token_value(document: dict) -> tuple[str, int | None]:
    data = document.get("data", document)
    if isinstance(data, list):
        data = data[0] if data else {}
    if isinstance(data, str):
        return data, None
    if not isinstance(data, dict):
        raise RuntimeError("DolphinScheduler token response is invalid")
    value = data.get("token") or data.get("accessToken") or data.get("value")
    token_id = data.get("id")
    if not value:
        raise RuntimeError("DolphinScheduler token response has no token")
    return str(value), int(token_id) if token_id is not None else None


def _find_token_id(token: str, user_id: int) -> int | None:
    """Resolve the generated/current token to its server-side id without logging it."""
    response = _request("/access-tokens?" + urlencode({"pageNo": 1, "pageSize": 100}), token, "GET")
    data = response.get("data") or {}
    entries = data.get("totalList", []) if isinstance(data, dict) else []
    for entry in entries:
        if not isinstance(entry, dict) or int(entry.get("userId", -1)) != user_id:
            continue
        if entry.get("token") == token and entry.get("id") is not None:
            return int(entry["id"])
    return None


def load() -> dict:
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))


def save(document: dict) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".token-", dir=TOKEN_FILE.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(document, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, TOKEN_FILE)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def rotate_once(now: datetime | None = None) -> dict:
    if not BASE_URL or USER_ID <= 0:
        raise RuntimeError("DolphinScheduler base URL and service user ID are required")
    now = now or datetime.now(timezone.utc)
    document = load()
    current = str(document.get("current", ""))
    if not current:
        raise RuntimeError("current scheduler token is missing")
    previous_id = document.get("currentId") or _find_token_id(current, USER_ID)
    expiry = now + timedelta(days=TTL_DAYS)
    path = CREATE_PATH + "?" + urlencode({
        "userId": USER_ID,
        "expireTime": expiry.strftime("%Y-%m-%d %H:%M:%S"),
    })
    response = _request(path, current, "POST")
    new_token, new_id = _token_value(response)
    new_id = new_id or _find_token_id(new_token, USER_ID)
    if new_id is None:
        raise RuntimeError("DolphinScheduler token id could not be resolved")
    previous_expires = now + timedelta(minutes=OVERLAP_MINUTES)
    updated = {
        "version": str(uuid.uuid4()),
        "current": new_token,
        "previous": current,
        "currentId": new_id,
        "previousId": previous_id,
        "currentExpiresAt": expiry.isoformat(),
        "previousExpiresAt": previous_expires.isoformat(),
        "rotatedAt": now.isoformat(),
        "nextRotationAt": (now + timedelta(hours=ROTATE_HOURS)).isoformat(),
    }
    save(updated)
    return {"version": updated["version"], "currentExpiresAt": updated["currentExpiresAt"]}


def revoke_previous(document: dict | None = None) -> None:
    document = document or load()
    previous_id = document.get("previousId")
    previous_expires = document.get("previousExpiresAt")
    if not previous_id or not previous_expires:
        return
    if datetime.fromisoformat(previous_expires.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        return
    current = str(document.get("current", ""))
    _request(f"/access-tokens/{previous_id}", current, "DELETE")
    document["previous"] = ""
    document["previousId"] = None
    document["previousExpiresAt"] = None
    save(document)


def run() -> None:
    while True:
        try:
            document = load()
            next_rotation = document.get("nextRotationAt")
            if not next_rotation or datetime.fromisoformat(next_rotation.replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                rotate_once()
            revoke_previous()
        except Exception as exc:
            print(f"[token-rotator] rotation failed: {type(exc).__name__}", flush=True)
        time.sleep(300)


if __name__ == "__main__":
    run()

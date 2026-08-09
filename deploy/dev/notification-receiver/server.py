from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SECRET = os.environ.get("DATAOS_NOTIFICATION_RECEIVER_SECRET", "")
WINDOW = int(os.environ.get("DATAOS_NOTIFICATION_RECEIVER_WINDOW_SECONDS", "300"))
seen_nonces: dict[str, float] = {}
receipts: dict[str, dict] = {}
lock = threading.Lock()


def response(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class Handler(BaseHTTPRequestHandler):
    server_version = "dataos-notification-receiver/0.1"

    def do_GET(self) -> None:
        if self.path == "/healthz":
            response(self, 200, {"status": "UP"})
            return
        if self.path == "/receipts":
            with lock:
                response(self, 200, {"receipts": list(receipts.values())[-100:]})
            return
        response(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/notify":
            response(self, 404, {"error": "not found"})
            return
        if not SECRET:
            response(self, 503, {"error": "receiver secret is not configured"})
            return
        try:
            timestamp = self.headers["X-Data-OS-Notification-Timestamp"]
            nonce = self.headers["X-Data-OS-Notification-Nonce"]
            signature = self.headers["X-Data-OS-Notification-Signature"]
            idem = self.headers["Idempotency-Key"]
            timestamp_value = int(timestamp)
        except (KeyError, ValueError):
            response(self, 401, {"error": "signature headers are required"})
            return
        if abs(int(time.time()) - timestamp_value) > WINDOW:
            response(self, 401, {"error": "timestamp outside replay window"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        expected = "v1=" + base64url(hmac.new(SECRET.encode(), (timestamp + "." + nonce + ".").encode() + body,
                                               hashlib.sha256).digest())
        if not hmac.compare_digest(expected, signature):
            response(self, 401, {"error": "invalid signature"})
            return
        with lock:
            now = time.time()
            seen_nonces.update({key: value for key, value in seen_nonces.items() if value > now - WINDOW})
            if nonce in seen_nonces:
                response(self, 409, {"error": "nonce replay"})
                return
            seen_nonces[nonce] = now
            existing = next((item for item in receipts.values() if item["idempotencyKey"] == idem), None)
            if existing:
                response(self, 200, existing)
                return
            try:
                message = json.loads(body)
            except json.JSONDecodeError:
                response(self, 400, {"error": "body must be JSON"})
                return
            receipt = {"receiptId": str(uuid.uuid4()), "idempotencyKey": idem,
                       "tenantId": message.get("tenantId"), "recipientId": message.get("recipientId"),
                       "receivedAt": int(now)}
            receipts[receipt["receiptId"]] = receipt
        response(self, 202, receipt)

    def log_message(self, *_args) -> None:
        return


def base64url(value: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()

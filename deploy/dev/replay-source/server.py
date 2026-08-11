#!/usr/bin/env python3
"""Deterministic, de-identified clinical HTTP source for acceptance replay.

This is deliberately a development/acceptance fixture. It contains no PHI and
does not replace a hospital LIS/EMR/OR adapter. The same response contract is
what the LIS HTTP SeaTunnel template consumes after the hospital supplies its
real endpoint and field mapping.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
FIXTURES = {
    "/api/lab/results": ("LIS", "lis-results.json"),
    "/api/emr/diagnoses": ("EMR", "emr-diagnoses.json"),
    "/api/surgery/records": ("SURGERY", "surgery-records.json"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "data-os-replay/1"

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._send(200, {"status": "UP"})
            return
        contract = FIXTURES.get(parsed.path)
        if contract is None:
            self._send(404, {"error": "fixture endpoint not found"})
            return
        system, filename = contract
        payload = json.loads((ROOT / "fixtures" / filename).read_text(encoding="utf-8"))
        query = parse_qs(parsed.query)
        watermark_start = query.get("since", ["1970-01-01T00:00:00Z"])[0]
        watermark_end = query.get("until", ["9999-12-31T23:59:59Z"])[0]
        payload["data"] = [
            row for row in payload.get("data", [])
            if self._in_window(row.get("update_time"), watermark_start, watermark_end)
        ]
        payload["sourceSystem"] = system
        payload["watermarkStart"] = watermark_start
        payload["watermarkEnd"] = watermark_end
        self._send(200, payload)

    def log_message(self, format: str, *args: object) -> None:
        print("replay", format % args)

    def _send(self, code: int, body: dict[str, object]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _in_window(self, value: object, start: str, end: str) -> bool:
        if not isinstance(value, str):
            return False
        try:
            updated = self._parse_time(value)
            return self._parse_time(start) <= updated < self._parse_time(end)
        except ValueError:
            return False

    def _parse_time(self, value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18084)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"clinical replay source listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

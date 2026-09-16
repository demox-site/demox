#!/usr/bin/env python3
"""HTTP trigger for custom-domain cert + nginx sync. Bound to 127.0.0.1:7391."""
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = "/opt/demox-customer-proxy"
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")


def load_secret():
    secret = os.environ.get("PROVISION_SECRET", "")
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("PROVISION_SECRET="):
                    secret = line.split("=", 1)[1].strip()
    return secret


SECRET = load_secret()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/_demox/provision":
            self._send(404, {"ok": False, "error": "not found"})
            return
        auth = self.headers.get("Authorization", "")
        if not SECRET or auth != f"Bearer {SECRET}":
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        hostname = str(data.get("hostname") or "").strip().lower()
        if not HOST_RE.match(hostname):
            self._send(400, {"ok": False, "error": "invalid hostname"})
            return
        result = subprocess.run(
            [os.path.join(ROOT, "sync.sh"), "--host", hostname],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        ok = result.returncode == 0
        self._send(200 if ok else 500, {
            "ok": ok,
            "hostname": hostname,
            "code": result.returncode,
            "log": (result.stdout + result.stderr)[-2000:]
        })


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("PROVISION_SECRET missing")
    ThreadingHTTPServer(("127.0.0.1", 7391), Handler).serve_forever()

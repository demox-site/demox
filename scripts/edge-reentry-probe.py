#!/usr/bin/env python3
"""D0: did the router's origin fetch re-enter the edge function?

  python3 scripts/edge-reentry-probe.py https://www.demox.site/
  python3 scripts/edge-reentry-probe.py --self-test

Reads x-demox-edge-hop and x-demox-route. No secrets and no admin account.
A normal public site must stay 200. Re-entry is reported, and it fails the run
only when that public site is blocked.
"""
import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

HOP = "x-demox-edge-hop"
HOP_VALUE = "guard"
BAN_STATUSES = {401, 403, 503}


def judge(status, headers, body):
    """Decide re-entry from one public-site response. ok is false when the site is blocked."""
    route = (headers.get("x-demox-route") or "")
    hop = headers.get(HOP) or ""
    if status in BAN_STATUSES or status != 200:
        return {"ok": False, "reentry": "blocked", "status": status, "route": route, "hop": hop}
    reentry = "yes" if hop == HOP_VALUE or "origin-guard=" in route else "no"
    if body and b"\xe6\x97\xa0\xe6\xb3\x95\xe8\xae\xbf\xe9\x97\xae" in body and status == 403:
        return {"ok": False, "reentry": "blocked", "status": status, "route": route, "hop": hop}
    return {"ok": True, "reentry": reentry, "status": status, "route": route, "hop": hop}


def fetch(url):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": "demox-edge-d0/1",
        "Accept": "text/html",
        "Cache-Control": "no-cache",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        status, body, hdrs = resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as exc:
        status, body, hdrs = exc.code, exc.read(), exc.headers
    headers = {k.lower(): v for k, v in hdrs.items()}
    return judge(status, headers, body)


def probe(urls):
    fail = 0
    for url in urls:
        result = fetch(url)
        label = "PASS" if result["ok"] else "FAIL"
        if not result["ok"]:
            fail = 1
        print(
            f"{label} {url} status={result['status']} reentry={result['reentry']} "
            f"route={result['route'] or '-'} hop={result['hop'] or '-'}"
        )
    print("D0 OK" if not fail else "D0 FAILED")
    return fail


def self_test():
    seen = {"reentry": None, "quiet": None}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/reentry"):
                body = b"public"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("x-demox-route", "origin-guard=internal")
                self.send_header(HOP, HOP_VALUE)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/blocked"):
                body = "无法访问".encode()
                self.send_response(403)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = b"public"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("x-demox-route", "resolve=miss; origin=ok")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        seen["reentry"] = fetch(f"http://127.0.0.1:{port}/reentry")
        seen["quiet"] = fetch(f"http://127.0.0.1:{port}/quiet")
        seen["blocked"] = fetch(f"http://127.0.0.1:{port}/blocked")
    finally:
        server.shutdown()
    if seen["reentry"]["reentry"] != "yes" or not seen["reentry"]["ok"]:
        raise SystemExit("reentry fixture was not detected: " + json.dumps(seen["reentry"]))
    if seen["quiet"]["reentry"] != "no" or not seen["quiet"]["ok"]:
        raise SystemExit("quiet public site should stay open: " + json.dumps(seen["quiet"]))
    if seen["blocked"]["ok"]:
        raise SystemExit("blocked public site must fail the probe")
    print("D0 SELF-TEST OK")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        sys.exit(self_test())
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(probe(sys.argv[1:]))

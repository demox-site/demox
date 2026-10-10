#!/usr/bin/env python3
"""Edge P0 method matrix (GET/HEAD/POST/PUT/OPTIONS) for subdomain-router.

  baseline OUT.json          record production WITHOUT demox_access (status, length, sha256); every request
                             carries only the site's own cookie `p0_probe=1`
  compare  BASELINE.json     same requests WITH a fake demox_access cookie; each item must equal
                             the baseline (status + body sha256), carry both demox_access expiry
                             Set-Cookie headers, and the probe function must not see demox_access.
Exit 1 on any failure. Only sends read-style requests with a tiny JSON body; no credentials.
"""
import hashlib, json, sys, time, urllib.request, urllib.error, ssl

PAGES = ["https://www.demox.site/", "https://coverage.demox.site/",
         "https://uv0fkz31.demox.site/", "https://letters-from-the-hill.demox.site/"]
FUNCTIONS = ["https://uv0fkz31.demox.site/api/cookies"]
METHODS = ["GET", "HEAD", "POST", "PUT", "OPTIONS"]
SITE_COOKIE = "p0_probe=1"
FAKE = "demox_access=p0-fake-not-a-token; " + SITE_COOKIE
CTX = ssl.create_default_context()


def fetch(method, url, cookie=None):
    headers = {"User-Agent": "demox-edge-p0/1", "Accept": "text/html,application/json", "Cache-Control": "no-cache"}
    data = None
    if method in ("POST", "PUT"):
        data = b'{"p0":true}'
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=30, context=CTX)
        status, body, hdrs = resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        status, body, hdrs = e.code, e.read(), e.headers
    set_cookies = hdrs.get_all("Set-Cookie") or []
    return {
        "status": status,
        "length": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "route": hdrs.get("x-demox-route") or "",
        "set_cookie": set_cookies,
        "body": body,
    }


def items():
    for url in PAGES + FUNCTIONS:
        for m in METHODS:
            yield m, url


def baseline(out):
    res = {"taken_at": time.strftime("%Y-%m-%d %H:%M:%S %z"), "cookie": SITE_COOKIE, "items": []}
    for m, url in items():
        r = fetch(m, url, SITE_COOKIE)
        if any(c.startswith("demox_access=") for c in r["set_cookie"]):
            print("WARN baseline response already sets demox_access", m, url)
        res["items"].append({"method": m, "url": url, "status": r["status"], "length": r["length"],
                             "sha256": r["sha256"], "route": r["route"]})
        print(f"{m:7} {url:48} {r['status']} len {r['length']:6} sha {r['sha256'][:16]}")
    json.dump(res, open(out, "w"), indent=1)
    print("saved", out)


def has_expiry(set_cookies):
    dom = any(c.startswith("demox_access=;") and "Domain=.demox.site" in c and "Max-Age=0" in c for c in set_cookies)
    host = any(c.startswith("demox_access=;") and "Domain=" not in c and "Max-Age=0" in c for c in set_cookies)
    return dom and host


def compare(path):
    base = json.load(open(path))
    fail = 0
    for b in base["items"]:
        m, url = b["method"], b["url"]
        r = fetch(m, url, FAKE)
        problems = []
        if r["status"] != b["status"]:
            problems.append(f"status {r['status']} != baseline {b['status']}")
        if r["sha256"] != b["sha256"]:
            problems.append(f"body len {r['length']} sha {r['sha256'][:16]} != baseline len {b['length']} sha {b['sha256'][:16]}")
        if not has_expiry(r["set_cookie"]):
            problems.append("missing demox_access expiry Set-Cookie (Domain=.demox.site + host-only)")
        if url in FUNCTIONS and m in ("GET", "POST", "PUT") and r["status"] == 200:
            if b"demox_access" in r["body"]:
                problems.append("function saw demox_access")
            if b"p0_probe" not in r["body"]:
                problems.append("function lost the site's own cookie")
        tag = "PASS" if not problems else "FAIL"
        print(f"{tag} [cookie vs baseline] {m:7} {url} → {r['status']} len {r['length']} {r['route'] and '(' + r['route'] + ')'}"
              + ("" if not problems else " :: " + "; ".join(problems)))
        fail |= bool(problems)
    print("MATRIX OK" if not fail else "MATRIX FAILED")
    return fail


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("baseline", "compare"):
        print(__doc__); sys.exit(2)
    sys.exit(baseline(sys.argv[2]) if sys.argv[1] == "baseline" else compare(sys.argv[2]))

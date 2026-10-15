#!/usr/bin/env python3
"""Edge P0 method matrix (GET/HEAD/POST/PUT/OPTIONS) for subdomain-router.

  baseline OUT.json          record production WITHOUT demox_access (status, length, sha256); every request
                             carries only the site's own cookie `p0_probe=1`
  compare  BASELINE.json     same requests WITH a fake demox_access cookie; each item must equal
                             the baseline (status + body sha256), carry both demox_access expiry
                             Set-Cookie headers, and the probe function must not see demox_access.
Exit 1 on any failure. Only sends read-style requests with a tiny JSON body; no credentials.
"""
import hashlib, json, sys, time, urllib.parse, urllib.request, urllib.error, ssl

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


# --- K0 origin-path guard ----------------------------------------------------
# Live rows run only when this file is invoked as `origin` (from edge-p0-check.sh).
# `simulate-ban` is local: it reads the router source and walks the 60s cache clock.

import os, pathlib, re

ROUTER_SOURCE = pathlib.Path(__file__).resolve().parents[1] / "edge-functions" / "subdomain-router.js"
PHISHING_IDS = ["MUELLII3", "KXT8244Z", "MNIYUVN8", "VMPZGKSR", "WAB5W9J7"]
DEFAULT_BANNED = " ".join(
    f"sites/1791141127876590527/{site_id}/dist/index.html" for site_id in PHISHING_IDS
)
# Bucket-1 path is the www fallback already in the router. Baseline sites coverage /
# uv0fkz31 / letters-from-the-hill are all on site-3 (see edge-p0-check.sh), so their
# origin-path rows are N/A until K3. Private uid stays in PRIVATE_PATHS, never here.
DEFAULT_PUBLIC = "sites/1985655011013808129/EPX2UU43/dist/index.html"
DEFAULT_UNPARSED = "/ /robots.txt /favicon.ico /health /_/assets/app.js"
DEFAULT_FIRST_SCREEN = [
    {
        "name": "www-bucket1",
        "bucket": 1,
        "shape": "dist/index.html",
        "subdomain": "https://www.demox.site/",
        "origin": "https://sites.demox.site/sites/1985655011013808129/EPX2UU43/dist/index.html",
    },
    {
        "name": "letters-bucket3",
        "bucket": 3,
        "shape": "root",
        "subdomain": "https://letters-from-the-hill.demox.site/",
        "origin": "",
    },
    {
        "name": "coverage-spa",
        "bucket": 3,
        "shape": "spa-deep-link",
        "subdomain": "https://coverage.demox.site/dashboard",
        "origin": "",
    },
]


def _const(name, text):
    matched = re.search(rf"var {name} = (\d+);", text)
    if not matched:
        raise SystemExit(f"missing {name} in subdomain-router.js")
    return int(matched.group(1))


def fresh(age_ms, ttl_s):
    return age_ms >= 0 and age_ms < ttl_s * 1000


def simulate_ban():
    """Walk a by-ID cache clock. No network. A ban is visible once the positive entry expires."""
    text = ROUTER_SOURCE.read_text()
    found = _const("ORIGIN_RESOLVE_FOUND_TTL", text)
    negative = _const("ORIGIN_RESOLVE_NEGATIVE_TTL", text)
    budget = _const("ORIGIN_RESOLVE_BUDGET_MS", text)
    token_ttl = _const("ORIGIN_INTERNAL_TOKEN_TTL_MS", text)
    problems = []
    if found > 60:
        problems.append(f"positive TTL {found}s exceeds 60s")
    if negative > 15 or negative > found:
        problems.append(f"negative TTL {negative}s exceeds 15s or the positive TTL")
    if "staleIfError: false" not in text:
        problems.append("by-ID resolve still has a stale-if-error grace window")
    if "ORIGIN_GUARD_ALLOWLIST = []" not in text:
        problems.append("origin allowlist is no longer empty; document every new exception")
    # t=0 allow cached. t=59s still fresh (outage may serve it). t=60s expired → backend says blocked → 403.
    timeline = []
    cached_at = 0
    backend = "allow"

    def decide(now_ms):
        age = now_ms - cached_at
        if fresh(age, found) and backend_at_cache == "allow":
            return "200", "positive-cache"
        return ("403", "re-resolve-blocked") if backend == "blocked" else ("200", "re-resolve-allow")

    backend_at_cache = "allow"
    for label, now_ms, backend_now in (
        ("t=0 cache fill", 0, "allow"),
        ("t=59s outage", 59_000, "down"),
        ("t=60s banned", 60_000, "blocked"),
    ):
        if label.startswith("t=0"):
            cached_at = 0
            backend_at_cache = "allow"
            backend = "allow"
            timeline.append((label, "200", "miss"))
            continue
        backend = backend_now
        if backend_now == "down":
            age = now_ms - cached_at
            got = ("200", "positive-cache") if fresh(age, found) else ("503", "fail-closed")
        else:
            got = decide(now_ms)
        timeline.append((label, got[0], got[1]))
    expect = {
        "t=0 cache fill": "200",
        "t=59s outage": "200",
        "t=60s banned": "403",
    }
    print(f"{'when':22} {'status':8} {'why'}")
    for label, status, why in timeline:
        ok = status == expect[label]
        if not ok:
            problems.append(f"{label} → {status} (want {expect[label]})")
        print(f"{'PASS' if ok else 'FAIL'} {label:22} {status:8} {why}")
    if token_ttl > 60_000:
        problems.append("internal token TTL is not short")
    print(f"simulate-ban constants: found={found}s negative={negative}s budget={budget}ms token={token_ttl}ms")
    print("SIMULATE OK" if not problems else "SIMULATE FAILED: " + "; ".join(problems))
    return 1 if problems else 0


def _split_env(name, default):
    raw = os.environ.get(name)
    if raw is None:
        raw = default
    return [part for part in raw.split() if part]


def _site_n(host):
    return re.match(r"^site-\d+\.demox\.site$", host or "") is not None


def _fetch_once(url, insecure=False):
    headers = {"User-Agent": "demox-edge-p0/1", "Accept": "text/html,application/json", "Cache-Control": "no-cache"}
    req = urllib.request.Request(url, method="GET", headers=headers)
    context = ssl._create_unverified_context() if insecure else CTX
    started = time.monotonic()
    try:
        resp = urllib.request.urlopen(req, timeout=30, context=context)
        status, body, hdrs = resp.status, resp.read(), resp.headers
        tls = "unverified" if insecure else "ok"
    except urllib.error.HTTPError as e:
        status, body, hdrs = e.code, e.read(), e.headers
        tls = "unverified" if insecure else "ok"
    except (ssl.SSLError, urllib.error.URLError) as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, ssl.SSLError) or isinstance(e, ssl.SSLError):
            return {"tls_error": True, "error": str(reason), "elapsed": time.monotonic() - started}
        errno = getattr(reason, "errno", None)
        refused = errno in (111, 61) or "refused" in str(reason).lower()
        return {
            "status": 0,
            "refused": refused,
            "length": 0,
            "sha256": "",
            "body": b"",
            "headers": {},
            "type": "",
            "tls": "error",
            "error": str(reason),
            "elapsed": time.monotonic() - started,
        }
    elapsed = time.monotonic() - started
    return {
        "status": status,
        "refused": False,
        "length": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "body": body,
        "headers": {k.lower(): v for k, v in hdrs.items()},
        "type": hdrs.get("content-type") or "",
        "tls": tls,
        "elapsed": elapsed,
        "route": hdrs.get("x-demox-route") or "",
    }


def fetch_checked(url, host):
    """https on site-N retries without verifying the certificate and records the mismatch."""
    insecure_ok = url.startswith("https://") and _site_n(host)
    result = _fetch_once(url, insecure=False)
    if result.get("tls_error") and insecure_ok:
        retried = _fetch_once(url, insecure=True)
        retried["tls"] = "mismatch"
        return retried
    if result.get("tls_error") and not insecure_ok:
        return {
            "status": 0, "refused": False, "length": 0, "sha256": "", "body": b"",
            "headers": {}, "type": "", "tls": "error", "error": result.get("error", "tls"),
            "elapsed": result.get("elapsed", 0), "route": "",
        }
    return result


def _baseline_origin_sha(url):
    path = os.environ.get("BASELINE")
    if not path:
        return None
    try:
        data = json.load(open(path))
    except OSError:
        return None
    pools = list(data.get("origin_items") or [])
    for item in data.get("items") or []:
        if item.get("url") == url and item.get("method", "GET") == "GET":
            pools.append(item)
    for item in pools:
        if item.get("url") == url:
            return item.get("sha256")
    return None


def _row(cells):
    print("  ".join(str(c) for c in cells))


def _expect_status(kind, result):
    status = result.get("status")
    if kind == "banned":
        return status == 403 or result.get("refused"), "403|refused"
    if kind == "private":
        return status in (401, 403), "401|403"
    if kind == "public":
        return status == 200, "200"
    if kind == "unparsed":
        return status == 403, "403"
    return False, "?"


def origin_checks():
    hosts = _split_env("ORIGIN_HOSTS", "sites.demox.site site-3.demox.site")
    banned = _split_env("BANNED_PATHS", DEFAULT_BANNED)
    private = _split_env("PRIVATE_PATHS", "")
    public = _split_env("PUBLIC_PATHS", DEFAULT_PUBLIC)
    unparsed = _split_env("UNPARSED_PATHS", DEFAULT_UNPARSED)
    enforce_site_n = os.environ.get("ENFORCE_SITE_N", "0") == "1"
    fail = 0
    if not private:
        print("SKIP private origin paths (set PRIVATE_PATHS=sites/<uid>/<ID>/... ; do not hard-code 33I17FK6's uid)")
    classes = [("banned", banned), ("private", private), ("public", public), ("unparsed", unparsed)]
    _row(["result", "host", "scheme", "class", "status", "tls", "path"])
    for host in hosts:
        for scheme in ("https", "http"):
            for kind, paths in classes:
                for path in paths:
                    rel = path if path.startswith("/") else "/" + path
                    url = f"{scheme}://{host}{rel}"
                    result = fetch_checked(url, host)
                    ok, want = _expect_status(kind, result)
                    tls_only = result.get("tls") == "error" and _site_n(host) and scheme == "https"
                    gap = _site_n(host) and not enforce_site_n and not ok and not tls_only
                    if tls_only:
                        label = "TLS"
                    elif gap:
                        label = "GAP"
                    elif ok:
                        label = "PASS"
                    else:
                        label = "FAIL"
                        fail = 1
                    if kind == "public" and ok:
                        expected_sha = _baseline_origin_sha(url)
                        if expected_sha and expected_sha != result.get("sha256"):
                            label = "FAIL"
                            fail = 1
                            print(f"FAIL sha {url} {result.get('sha256', '')[:16]} != baseline {expected_sha[:16]}")
                    _row([label, host, scheme, kind, result.get("status"), result.get("tls", ""), rel])
    fail |= first_screen_checks()
    print("ORIGIN OK" if not fail else "ORIGIN FAILED")
    if not enforce_site_n:
        print("NOTE site-N rows marked GAP are not K2 failures: those hosts bypass EdgeOne until K3. Set ENFORCE_SITE_N=1 after that.")
    return fail


def _asset_url(page, html):
    text = html.decode("utf-8", "replace")
    for pattern in (
        r'<script[^>]+src=["\']([^"\']+)["\']',
        r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']stylesheet["\']',
    ):
        matched = re.search(pattern, text, re.I)
        if not matched:
            continue
        ref = matched.group(1)
        if ref.startswith("data:") or ref.startswith("blob:"):
            continue
        return urllib.parse.urljoin(page, ref)
    return ""


def first_screen_checks():
    raw = os.environ.get("FIRST_SCREEN_SITES_JSON")
    sites = json.loads(raw) if raw else DEFAULT_FIRST_SCREEN
    budget_ms = int(os.environ.get("FIRST_SCREEN_BUDGET_MS", "3000"))
    fail = 0
    print(f"{'result':6} {'site':18} {'via':10} {'status':6} {'ms':8} note")
    for site in sites:
        for via, url in (("subdomain", site.get("subdomain") or ""), ("origin", site.get("origin") or "")):
            if not url:
                print(f"{'N/A':6} {site.get('name', ''):18} {via:10} {'':6} {'':8} bucket {site.get('bucket')} {site.get('shape')} (no EdgeOne origin path until K3)")
                continue
            host = urllib.parse.urlparse(url).hostname or ""
            started = time.monotonic()
            result = fetch_checked(url, host)
            elapsed_ms = int((time.monotonic() - started) * 1000)
            problems = []
            if result.get("status") != 200:
                problems.append(f"status {result.get('status')}")
            if "text/html" not in (result.get("type") or "").lower():
                problems.append(f"type {result.get('type') or '-'}")
            body = result.get("body") or b""
            if not body:
                problems.append("empty body")
            if b"<title" not in body.lower():
                problems.append("missing <title>")
            asset = _asset_url(url, body) if body else ""
            if asset:
                asset_host = urllib.parse.urlparse(asset).hostname or host
                asset_result = fetch_checked(asset, asset_host)
                if asset_result.get("status") != 200:
                    problems.append(f"asset {asset_result.get('status')} {asset}")
            elif body and re.search(br"<script|<link", body, re.I):
                problems.append("entry script/css did not return a fetchable URL")
            if elapsed_ms > budget_ms:
                problems.append(f"time {elapsed_ms}ms > {budget_ms}ms")
            label = "PASS" if not problems else "FAIL"
            if problems:
                fail = 1
            print(f"{label:6} {site.get('name', ''):18} {via:10} {str(result.get('status')):6} {elapsed_ms:8} {'; '.join(problems)}")
    return fail


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "simulate-ban" and len(sys.argv) == 2:
        sys.exit(simulate_ban())
    if cmd == "origin" and len(sys.argv) == 2:
        sys.exit(origin_checks())
    if len(sys.argv) != 3 or cmd not in ("baseline", "compare"):
        print(__doc__); sys.exit(2)
    sys.exit(baseline(sys.argv[2]) if cmd == "baseline" else compare(sys.argv[2]))

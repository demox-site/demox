#!/usr/bin/env python3
"""Edge P0 method matrix (GET/HEAD/POST/PUT/OPTIONS) for subdomain-router.

  baseline OUT.json          record production WITHOUT demox_access (status, length, sha256); every request
                             carries only the site's own cookie `p0_probe=1`
  compare  BASELINE.json     same requests WITH a fake demox_access cookie; each item must equal
                             the baseline (status + body sha256), carry both demox_access expiry
                             Set-Cookie headers, and the probe function must not see demox_access.
Exit 1 on any failure. Only sends read-style requests with a tiny JSON body; no credentials.

Also:
  d2                         live K2 matrix (ban id, public sites, http2 mismatch, cache key, CORS, 15s clock)
  d2-self-test               local checks for that matrix; no production traffic
  perf-baseline OUT.json     record median/p90 samples
  perf BASELINE.json         fail when median grows more than 15% or p90 more than 25%
  perf-self-test             lock those thresholds
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
# `simulate-ban` is local: it reads the router source and walks the 15s ban clock.

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
    """Walk a by-ID cache clock. No network. Ban and unban both land within 15s."""
    text = ROUTER_SOURCE.read_text()
    ban = _const("ORIGIN_RESOLVE_BAN_TTL", text)
    found = _const("ORIGIN_RESOLVE_FOUND_TTL", text)
    negative = _const("ORIGIN_RESOLVE_NEGATIVE_TTL", text)
    host_ttl = _const("RESOLVE_CACHE_TTL", text)
    object_max_age = _const("ORIGIN_OBJECT_MAX_AGE", text)
    budget = _const("ORIGIN_RESOLVE_BUDGET_MS", text)
    token_ttl = _const("ORIGIN_INTERNAL_TOKEN_TTL_MS", text)
    problems = []
    if ban != 15:
        problems.append(f"ban TTL {ban}s is not 15s")
    if found != 15:
        problems.append(f"allow TTL {found}s is not 15s; a ban must be visible by t=15s")
    if found > ban:
        problems.append(f"allow TTL {found}s outlives the {ban}s ban window")
    # Object max-age is a client Cache-Control only. It is not the EdgeOne node-cache TTL
    # and it is not the by-ID ban clock. Cache-hit safety is the function running first.
    if object_max_age != 60:
        problems.append(f"object client max-age {object_max_age}s is not the separate 60s constant")
    if "max-age=' + ORIGIN_OBJECT_MAX_AGE" not in text:
        problems.append("object Cache-Control is not using ORIGIN_OBJECT_MAX_AGE")
    if "ORIGIN_RESOLVE_BAN_TTL" in text and "max-age=' + ORIGIN_RESOLVE_BAN_TTL" in text:
        problems.append("object max-age is still tied to the ban TTL")
    if "max-age=' + ORIGIN_RESOLVE_FOUND_TTL" in text:
        problems.append("object max-age is still tied to the allow TTL")
    if negative > ban:
        problems.append(f"ban verdict TTL {negative}s outlives the {ban}s window")
    if host_ttl > 60:
        problems.append(f"non-ban host resolve TTL {host_ttl}s exceeds 60s")
    if "staleIfError: false" not in text:
        problems.append("by-ID resolve still has a stale-if-error grace window")
    if "ORIGIN_GUARD_ALLOWLIST = []" not in text:
        problems.append("origin allowlist is no longer empty; document every new exception")
    # Allow cached at t=0, then the backend bans. 403 once that entry expires (15s).
    # The blocked entry itself expires 15s later, so an unban is a 200. After the
    # new allow entry expires, a resolver failure is 503 and does not serve stale.
    timeline = []
    cached_at = 0
    cached_kind = "allow"

    def status_at(now_ms, backend):
        age = now_ms - cached_at
        limit = found if cached_kind == "allow" else negative
        if fresh(age, limit):
            if cached_kind == "allow":
                return "200", "positive-cache"
            return "403", "ban-cache"
        if backend == "down":
            return "503", "fail-closed"
        if backend == "blocked":
            return "403", "re-resolve-blocked"
        return "200", "re-resolve-allow"

    def remember(now_ms, kind):
        nonlocal cached_at, cached_kind
        cached_at = now_ms
        cached_kind = kind

    steps = (
        ("t=0 allow fill", 0, "allow", True),
        ("t=14s ban hidden by fresh allow", 14_000, "blocked", False),
        ("ban at t=0 seen by t=15s", 15_000, "blocked", True),
        ("t=14s after ban, unban still cached", 29_000, "allow", False),
        ("unban seen by t=15s", 30_000, "allow", True),
        ("t=14s outage", 44_000, "down", False),
        ("resolver failure after expiry", 45_000, "down", False),
    )
    expect = {
        "t=0 allow fill": "200",
        "t=14s ban hidden by fresh allow": "200",
        "ban at t=0 seen by t=15s": "403",
        "t=14s after ban, unban still cached": "403",
        "unban seen by t=15s": "200",
        "t=14s outage": "200",
        "resolver failure after expiry": "503",
    }
    for label, now_ms, backend, store in steps:
        if label.startswith("t=0"):
            remember(0, "allow")
            timeline.append((label, "200", "miss"))
            continue
        status, why = status_at(now_ms, backend)
        timeline.append((label, status, why))
        if store and status in ("200", "403"):
            remember(now_ms, "allow" if status == "200" else "blocked")
    print(f"{'when':36} {'status':8} {'why'}")
    for label, status, why in timeline:
        ok = status == expect[label]
        if not ok:
            problems.append(f"{label} → {status} (want {expect[label]})")
        print(f"{'PASS' if ok else 'FAIL'} {label:36} {status:8} {why}")
    if token_ttl > 60_000:
        problems.append("internal token TTL is not short")
    print(
        f"simulate-ban constants: ban={ban}s found={found}s negative={negative}s "
        f"host={host_ttl}s object-max-age={object_max_age}s budget={budget}ms token={token_ttl}ms"
    )
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


# --- D2 live matrix and perf -------------------------------------------------
# Thresholds are the acceptance limits. Do not raise them to make a run pass.
import math
PERF_MEDIAN_INCREASE_MAX = 0.15
PERF_P90_INCREASE_MAX = 0.25
PERF_SAMPLES = 7
BAN_SITE_ID = "33I17FK6"
# Not an owner id. A wrong uid and a real ban are the same public 403.
BAN_PROBE_UID = "k2probe"
D2_GUARDED_HOSTS = [
    "sites.demox.site",
    "sites-eclick.demox.site",
    "origin-3.demox.site",
    "site-3.demox.site",
]
D2_UNKNOWN_HOST = "k2-matrix-unbound.demox.site"
# Origin paths that exist in repo fixtures. TKEMDUR9's uid is not in the repo.
DEFAULT_D2_PUBLIC = [
    {
        "id": "EPX2UU43",
        "subdomain": "https://www.demox.site/",
        "origin": "https://sites.demox.site/sites/1985655011013808129/EPX2UU43/dist/index.html",
    },
    {
        "id": "LCJAIAC0",
        "subdomain": "https://letters-from-the-hill.demox.site/",
        "origin": "https://sites.demox.site/sites/1985655011013808129/LCJAIAC0/dist/index.html",
    },
    {
        "id": "TKEMDUR9",
        "subdomain": "https://beixian-lighting.demox.site/",
        "origin": "",
    },
]


def _percentile(values, pct):
    ordered = sorted(values)
    if not ordered:
        raise SystemExit("no latency samples")
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def latency_over_budget(baseline_ms, current_ms):
    """Return problem strings. Empty means median +15% and p90 +25% both hold."""
    base_median = _percentile(baseline_ms, 50)
    base_p90 = _percentile(baseline_ms, 90)
    cur_median = _percentile(current_ms, 50)
    cur_p90 = _percentile(current_ms, 90)
    problems = []
    if base_median <= 0 or base_p90 <= 0:
        return ["baseline latency is not positive"]
    median_ratio = (cur_median - base_median) / base_median
    p90_ratio = (cur_p90 - base_p90) / base_p90
    if median_ratio > PERF_MEDIAN_INCREASE_MAX:
        problems.append(f"median +{median_ratio:.0%} exceeds +{PERF_MEDIAN_INCREASE_MAX:.0%}")
    if p90_ratio > PERF_P90_INCREASE_MAX:
        problems.append(f"p90 +{p90_ratio:.0%} exceeds +{PERF_P90_INCREASE_MAX:.0%}")
    return problems


def _const_str(name, text):
    matched = re.search(rf"var {name} = '([^']*)';", text)
    if not matched:
        raise SystemExit(f"missing string {name} in subdomain-router.js")
    return matched.group(1)


def cors_spec(text):
    enabled = re.search(r"var CORS_ENABLED = (true|false);", text)
    if not enabled:
        raise SystemExit("missing CORS_ENABLED")
    return {
        "enabled": enabled.group(1) == "true",
        "allow_headers": _const_str("ORIGIN_OPTIONS_CORS_ALLOW_HEADERS", text),
        "expose_headers": _const_str("ORIGIN_CORS_EXPOSE_HEADERS", text),
    }


def _ac_headers(headers):
    return {k.lower(): v for k, v in headers.items() if k.lower().startswith("access-control-")}


def cors_problems(headers, status, method, spec):
    """Headers must match the router: off means none; on means the fixed set."""
    found = _ac_headers(headers)
    if not spec["enabled"]:
        return [f"unexpected {name}" for name in sorted(found)]
    denied = status in (400, 403, 404, 405, 503)
    if method == "OPTIONS":
        if denied:
            return [f"OPTIONS {status} carried CORS"] if found else []
        expect = {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
            "access-control-allow-headers": spec["allow_headers"],
            "access-control-max-age": "86400",
        }
    elif status == 304 or (200 <= status < 300):
        expect = {
            "access-control-allow-origin": "*",
            "access-control-expose-headers": spec["expose_headers"],
        }
    else:
        return [f"{status} carried CORS"] if found else []
    problems = []
    if "access-control-allow-credentials" in found:
        problems.append("Allow-Credentials is set")
    for name, value in expect.items():
        if found.get(name) != value:
            problems.append(f"{name}={found.get(name)!r} want {value!r}")
    extra = sorted(set(found) - set(expect) - {"access-control-allow-credentials"})
    for name in extra:
        problems.append(f"extra {name}")
    return problems


def mismatch_verdict(status):
    if status in (403, 421):
        return "pass"
    if status == 200:
        return "fail"
    return "fail"


def _public_sites():
    raw = os.environ.get("D2_PUBLIC_JSON")
    if raw:
        return json.loads(raw)
    return DEFAULT_D2_PUBLIC


def _sample_ms(url, count):
    samples = []
    for _ in range(count):
        host = urllib.parse.urlparse(url).hostname or ""
        result = fetch_checked(url, host)
        samples.append(int(result.get("elapsed", 0) * 1000))
    return samples


def perf_baseline(out):
    urls = [site["subdomain"] for site in _public_sites() if site.get("subdomain")]
    payload = {"kind": "edge-perf-baseline", "samples": PERF_SAMPLES, "items": []}
    for url in urls:
        ms = _sample_ms(url, PERF_SAMPLES)
        payload["items"].append({"url": url, "ms": ms})
        print(f"{url} median {_percentile(ms, 50)}ms p90 {_percentile(ms, 90)}ms")
    json.dump(payload, open(out, "w"), indent=1)
    print("saved", out)


def perf_compare(path):
    data = json.load(open(path))
    fail = 0
    for item in data.get("items") or []:
        url = item["url"]
        current = _sample_ms(url, len(item["ms"]))
        problems = latency_over_budget(item["ms"], current)
        label = "PASS" if not problems else "FAIL"
        if problems:
            fail = 1
        print(f"{label} {url} {'; '.join(problems) if problems else 'within +15% median / +25% p90'}")
    print("PERF OK" if not fail else "PERF FAILED")
    return fail


def perf_self_test():
    import math
    assert PERF_MEDIAN_INCREASE_MAX == 0.15
    assert PERF_P90_INCREASE_MAX == 0.25
    base = [100] * 7
    if latency_over_budget(base, [114] * 7):
        raise SystemExit("14% must pass")
    if not latency_over_budget(base, [116] * 7):
        raise SystemExit("16% median must fail")
    # median stays +10%, the top sample pushes p90 past +25%
    skewed = [110, 110, 110, 110, 110, 110, 130]
    problems = latency_over_budget(base, skewed)
    if not any("p90" in item for item in problems):
        raise SystemExit(f"p90 must fail, got {problems}")
    if any("median" in item for item in problems):
        raise SystemExit(f"median of the skewed set must pass, got {problems}")
    text = ROUTER_SOURCE.read_text()
    spec = cors_spec(text)
    if spec["enabled"]:
        raise SystemExit("CORS default in source is no longer off; update the live expectation on purpose")
    if cors_problems({"Access-Control-Allow-Origin": "*"}, 200, "GET", spec):
        pass
    else:
        raise SystemExit("default-off CORS must reject a stray allow-origin")
    full = dict(spec, enabled=True)
    options = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": spec["allow_headers"],
        "Access-Control-Max-Age": "86400",
    }
    if cors_problems(options, 204, "OPTIONS", full):
        raise SystemExit("full OPTIONS set must match the source constants")
    if not cors_problems(dict(options, **{"Access-Control-Allow-Credentials": "true"}), 204, "OPTIONS", full):
        raise SystemExit("credentials must be rejected")
    if cors_problems({}, 403, "GET", full):
        raise SystemExit("403 must carry no CORS headers in full mode")
    if mismatch_verdict(403) != "pass" or mismatch_verdict(421) != "pass" or mismatch_verdict(200) != "fail":
        raise SystemExit("mismatch verdict drifted")
    print("PERF SELF-TEST OK")
    return 0


def _d2_public_checks():
    fail = 0
    for site in _public_sites():
        for via, url in (("subdomain", site.get("subdomain") or ""), ("origin", site.get("origin") or "")):
            if via == "origin" and not url:
                print(f"SKIP {site.get('id')} origin (no uid in repo fixtures; set D2_PUBLIC_JSON)")
                continue
            host = urllib.parse.urlparse(url).hostname or ""
            result = fetch_checked(url, host)
            ok = result.get("status") == 200
            hop = (result.get("headers") or {}).get("x-demox-edge-hop", "")
            if via == "origin" and ok and hop != "guard":
                ok = False
            label = "PASS" if ok else "FAIL"
            if not ok:
                fail = 1
            print(f"{label} public {site.get('id')} {via} {result.get('status')} hop={hop or '-'} {url}")
    return fail


def _d2_ban_checks():
    fail = 0
    enforce = os.environ.get("ENFORCE_SITE_N", "0") == "1"
    path = f"/sites/{BAN_PROBE_UID}/{BAN_SITE_ID}/dist/index.html"
    hosts = list(D2_GUARDED_HOSTS) + [D2_UNKNOWN_HOST]
    extra = os.environ.get("D2_CUSTOM_HOST", "")
    if extra:
        hosts.append(extra)
    for host in hosts:
        url = f"https://{host}{path}"
        result = fetch_checked(url, host)
        status = result.get("status")
        ok = status == 403 or result.get("refused")
        gap = _site_n(host) and not enforce and not ok
        if gap:
            print(f"GAP ban {host} {status} (site-N bypasses EdgeOne until K3)")
            continue
        label = "PASS" if ok else "FAIL"
        if not ok:
            fail = 1
        print(f"{label} ban {BAN_SITE_ID} {host} {status} {path}")
        variant = f"https://{host}/sites/{BAN_PROBE_UID}/{BAN_SITE_ID.lower()}/dist/index.html"
        varied = fetch_checked(variant, host)
        if varied.get("status") == 200 and not (_site_n(host) and not enforce):
            print(f"FAIL ban case-variant 200 {variant}")
            fail = 1
    return fail


def _curl_http2(url, host_header):
    import subprocess
    proc = subprocess.run(
        [
            "curl", "--http2", "--silent", "--show-error", "--max-time", "20",
            "--path-as-is", "-D", "-", "-o", "/dev/null",
            "-H", f"Host: {host_header}",
            "-w", "\n%{http_code}",
            url,
        ],
        check=False, capture_output=True, text=True,
    )
    lines = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    status = 0
    if lines and lines[-1].isdigit():
        status = int(lines[-1])
    return status


def _node_http2_mismatch(url, authority, host_header):
    import subprocess
    script = r"""
const http2 = require('http2');
const url = new URL(process.argv[1]);
const authority = process.argv[2];
const hostHeader = process.argv[3];
const client = http2.connect(url.origin);
const req = client.request({
  ':method': 'GET',
  ':path': url.pathname + url.search,
  ':authority': authority,
  host: hostHeader
});
req.on('response', (headers) => {
  process.stdout.write(String(headers[':status'] || 0));
  client.close();
});
req.on('error', () => { process.stdout.write('0'); client.close(); });
req.setTimeout(20000, () => { req.close(); client.close(); });
req.end();
"""
    proc = subprocess.run(
        ["node", "-e", script, url, authority, host_header],
        check=False, capture_output=True, text=True, timeout=30,
    )
    raw = (proc.stdout or "").strip()
    return int(raw) if raw.isdigit() else 0


def _d2_mismatch_checks():
    fail = 0
    path = f"/sites/{BAN_PROBE_UID}/{BAN_SITE_ID}/dist/index.html"
    pairs = [
        ("https://sites.demox.site" + path, "sites.demox.site", "static.demox.site"),
        ("https://static.demox.site" + path, "static.demox.site", "sites.demox.site"),
    ]
    for url, authority, other in pairs:
        curled = _curl_http2(url, other)
        curled_ok = mismatch_verdict(curled) == "pass"
        print(f"{'PASS' if curled_ok else 'FAIL'} curl --http2 {authority} Host={other} {curled}")
        if not curled_ok:
            fail = 1
        crossed = _node_http2_mismatch(url, authority, other)
        crossed_ok = mismatch_verdict(crossed) == "pass"
        print(f"{'PASS' if crossed_ok else 'FAIL'} http2 :authority={authority} Host={other} {crossed}")
        if not crossed_ok:
            fail = 1
    return fail


def _d2_cache_case_checks():
    fail = 0
    sites = [site for site in _public_sites() if site.get("origin")]
    if not sites:
        print("SKIP cache-key case (no origin URL)")
        return 0
    origin = sites[0]["origin"]
    parsed = urllib.parse.urlparse(origin)
    upper = parsed._replace(path=parsed.path.replace("index.html", "Index.html")).geturl()
    mixed_host = urllib.parse.urlunparse(parsed._replace(netloc="Sites.Demox.Site"))
    for label, url in (("lower", origin), ("path-case", upper), ("host-case", mixed_host)):
        host = urllib.parse.urlparse(url).hostname or ""
        result = fetch_checked(url, host)
        headers = result.get("headers") or {}
        cache = headers.get("eo-cache-status") or headers.get("x-cache") or headers.get("age") or "-"
        hop = headers.get("x-demox-edge-hop", "")
        status = result.get("status")
        ran = hop == "guard" or "origin-guard=" in (result.get("route") or "")
        ok = status != 200 or ran
        if label == "lower":
            ok = status == 200 and ran
        if not ok:
            fail = 1
        print(f"{'PASS' if ok else 'FAIL'} cache-key {label} {status} hop={hop or '-'} cache={cache} {url}")
    return fail


def _d2_cors_checks():
    fail = 0
    spec = cors_spec(ROUTER_SOURCE.read_text())
    origin = next((site["origin"] for site in _public_sites() if site.get("origin")), "")
    banned = f"https://sites.demox.site/sites/{BAN_PROBE_UID}/{BAN_SITE_ID}/dist/index.html"
    rows = [("OPTIONS", "https://sites.demox.site/"), ("GET", origin), ("GET", banned)]
    for method, url in rows:
        if not url:
            continue
        if method == "GET":
            host = urllib.parse.urlparse(url).hostname or ""
            result = fetch_checked(url, host)
            headers = result.get("headers") or {}
            status = result.get("status") or 0
        else:
            headers, status = _options_headers(url)
        problems = cors_problems(headers, status, method, spec)
        label = "PASS" if not problems else "FAIL"
        if problems:
            fail = 1
        print(f"{label} cors {method} {status} {url} {'; '.join(problems)}")
    return fail


def _options_headers(url):
    req = urllib.request.Request(url, method="OPTIONS", headers={"User-Agent": "demox-edge-p0/1"})
    try:
        resp = urllib.request.urlopen(req, timeout=30, context=CTX)
        return {k.lower(): v for k, v in resp.headers.items()}, resp.status
    except urllib.error.HTTPError as e:
        return {k.lower(): v for k, v in e.headers.items()}, e.code


def d2_checks():
    fail = 0
    fail |= _d2_ban_checks()
    fail |= _d2_public_checks()
    fail |= _d2_mismatch_checks()
    fail |= _d2_cache_case_checks()
    fail |= _d2_cors_checks()
    fail |= simulate_ban()
    print("D2 OK" if not fail else "D2 FAILED")
    print("NOTE live 15s flip: simulate-ban is the clock. To watch a real ban, set BAN_WATCH_URL and re-run d2.")
    watch = os.environ.get("BAN_WATCH_URL", "")
    if watch:
        fail |= _watch_ban(watch)
    return fail


def _watch_ban(url):
    host = urllib.parse.urlparse(url).hostname or ""
    deadline = time.monotonic() + 15
    last = None
    while time.monotonic() <= deadline:
        last = fetch_checked(url, host)
        if last.get("status") == 403:
            print(f"PASS ban-watch 403 within 15s {url}")
            return 0
        time.sleep(1)
    print(f"FAIL ban-watch still {last.get('status') if last else 0} after 15s {url}")
    return 1


def d2_self_test():
    """Local http2 server: a crossed Host/:authority must not be classified as 200."""
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "")
            code = 421 if host and not host.startswith("127.0.0.1") else 200
            body = b"ok"
            self.send_response(code)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        status = _curl_http2(f"http://127.0.0.1:{port}/sites/k2probe/{BAN_SITE_ID}/x", "static.demox.site")
        if mismatch_verdict(status) != "pass":
            raise SystemExit(f"local curl mismatch status {status}")
    finally:
        server.shutdown()
    perf_self_test()
    print("D2 SELF-TEST OK")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "simulate-ban" and len(sys.argv) == 2:
        sys.exit(simulate_ban())
    if cmd == "origin" and len(sys.argv) == 2:
        sys.exit(origin_checks())
    if cmd == "d2" and len(sys.argv) == 2:
        sys.exit(d2_checks())
    if cmd == "d2-self-test" and len(sys.argv) == 2:
        sys.exit(d2_self_test())
    if cmd == "perf-self-test" and len(sys.argv) == 2:
        sys.exit(perf_self_test())
    if cmd == "perf-baseline" and len(sys.argv) == 3:
        perf_baseline(sys.argv[2]); sys.exit(0)
    if cmd == "perf" and len(sys.argv) == 3:
        sys.exit(perf_compare(sys.argv[2]))
    if len(sys.argv) != 3 or cmd not in ("baseline", "compare"):
        print(__doc__); sys.exit(2)
    sys.exit(baseline(sys.argv[2]) if cmd == "baseline" else compare(sys.argv[2]))

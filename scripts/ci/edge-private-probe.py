#!/usr/bin/env python3
"""私有站点登录门探针。

HTML（Accept: text/html）缺省或不可用的 Accept-Language 是 200 中文「登录后查看」，并且 Vary 含 Accept-Language。
en 是「Sign in to view」，同样带 Vary。
非 HTML 是 401 text/plain「Authentication required」。这一跳不要求 Vary。
地址只从 DEMOX_SMOKE_PRIVATE_SITE_URL 读取。
"""

import os
import sys
import urllib.error
import urllib.request


def judge(case, status, headers, body):
    text = body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body)
    vary = str(headers.get("vary") or headers.get("Vary") or "")
    vary_ok = "accept-language" in vary.lower()
    if case == "html-default" or case == "html-unusable":
        return status == 200 and "登录后查看" in text and vary_ok
    if case == "html-en":
        return status == 200 and "Sign in to view" in text and vary_ok
    if case == "plain":
        return status == 401 and text.strip() == "Authentication required"
    raise ValueError(case)


def fetch(url, headers):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": "demox-edge-private/1",
        "Cache-Control": "no-cache",
        **headers,
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        status, body, hdrs = resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as exc:
        status, body, hdrs = exc.code, exc.read(), exc.headers
    flat = {k.lower(): v for k, v in hdrs.items()}
    return status, flat, body


CASES = (
    ("html-default", {"Accept": "text/html"}),
    ("html-unusable", {"Accept": "text/html", "Accept-Language": "***"}),
    ("html-en", {"Accept": "text/html", "Accept-Language": "en"}),
    ("plain", {"Accept": "text/plain"}),
)


def probe(url):
    fail = 0
    for case, headers in CASES:
        status, hdrs, body = fetch(url, headers)
        ok = judge(case, status, hdrs, body)
        print(f"{'PASS' if ok else 'FAIL'} {case} status={status} vary={hdrs.get('vary', '-')}")
        if not ok:
            fail = 1
    return fail


def self_test():
    html = "<title>登录后查看 example.demox.site</title>".encode()
    english = "<title>Sign in to view example.demox.site</title>".encode()
    vary = {"vary": "Accept-Language"}
    assert judge("html-default", 200, vary, html)
    assert judge("html-unusable", 200, vary, html)
    assert not judge("html-default", 200, {}, html)
    assert judge("html-en", 200, vary, english)
    assert not judge("html-en", 200, vary, html)
    assert judge("plain", 401, {}, b"Authentication required")
    assert judge("plain", 401, {"vary": "Accept-Language"}, b"Authentication required\n")
    assert not judge("plain", 401, {}, b"login")
    assert not judge("plain", 200, {}, b"Authentication required")
    print("private probe self-test OK")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    url = os.environ.get("DEMOX_SMOKE_PRIVATE_SITE_URL", "").strip()
    if not url:
        print("FAIL 缺少 DEMOX_SMOKE_PRIVATE_SITE_URL", file=sys.stderr)
        return 1
    return probe(url)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Decide which release stages a master push should run.

The diff base is github.event.before when that commit is an ancestor of HEAD.
If before is missing or all zeros, use the latest successful release.yml head sha.
When both are ancestors, use the older one so a run cancelled by concurrency
is not dropped. Otherwise fall back to HEAD^.
"""

import fnmatch
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.request

def load_website_paths():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "website-paths.py")
    spec = importlib.util.spec_from_file_location("website_paths", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

is_website_release = load_website_paths().is_website_release

ZERO_SHA = "0" * 40
SHARED_RELEASE = {
    "scripts/ci/release-smoke.cjs",
    "scripts/ci/open-release-issue.cjs",
}

GROUPS = {
    "function_api": [
        "scf-code/function-api/**",
        "scf-code/website-api/**",
        "scf-code/mcp-api/**",
        "scf-code/cert-renew/**",
        "scf-deploy-packages/auth-api/**",
        "scripts/package-unified-scf.mjs",
        "scripts/ci/unified-scf-package-lock.json",
        "scripts/ci/scf-function-api.cjs",
        "scripts/ci/function-api-release.cjs",
        ".github/workflows/deploy-function-api.yml",
    ],
    "website": [],
    "edge": [
        "edge-functions/**",
        "scripts/ci/edge-deploy.cjs",
        "scripts/ci/edge-private-probe.py",
        "scripts/ci/edge-release-probes.sh",
        ".github/workflows/deploy-edge.yml",
    ],
    "www": [
        "src/**",
        "public/**",
        "index.html",
        "package.json",
        "package-lock.json",
        "vite.config.ts",
        "tailwind.config.ts",
        "postcss.config.js",
        "tsconfig*.json",
        "components.json",
        "scripts/generate-seo-pages.mjs",
        "scripts/ci/www-purge.cjs",
        "scripts/ci/www-bundle.cjs",
        ".github/workflows/deploy.yml",
    ],
}


def matches(path, pattern):
    if pattern.endswith("/**"):
        base = pattern[:-3]
        return path == base or path.startswith(base + "/")
    if any(ch in pattern for ch in "*?[]"):
        return fnmatch.fnmatch(path, pattern)
    return path == pattern


def classify(paths):
    selected = {name: False for name in GROUPS}
    for path in paths:
        if path in SHARED_RELEASE:
            for name in selected:
                selected[name] = True
            continue
        if is_website_release(path):
            selected["website"] = True
        for name, patterns in GROUPS.items():
            if any(matches(path, pattern) for pattern in patterns):
                selected[name] = True
    return selected


def format_outputs(selected):
    return "".join(f"{name}={'true' if selected[name] else 'false'}\n" for name in GROUPS)


def is_sha(value):
    return bool(re.fullmatch(r"[0-9a-fA-F]{40}", value or "")) and value.lower() != ZERO_SHA


def is_ancestor(older, newer="HEAD"):
    if not is_sha(older):
        return False
    proc = subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], capture_output=True)
    return proc.returncode == 0


def resolve_base(before, last_success, ancestor, head="HEAD"):
    """Prefer the older ancestor so a cancelled push is still in the diff."""
    usable = []
    for sha in (before, last_success):
        text = (sha or "").strip()
        if text in usable:
            continue
        if is_sha(text) and ancestor(text, head):
            usable.append(text)
    if not usable:
        return "HEAD^"
    if len(usable) == 1:
        return usable[0]
    first, second = usable
    if ancestor(first, second):
        return first
    if ancestor(second, first):
        return second
    return usable[0]


def last_successful_sha(env=None):
    env = os.environ if env is None else env
    token = str(env.get("GITHUB_TOKEN") or "").strip()
    repo = str(env.get("GITHUB_REPOSITORY") or "").strip()
    api = str(env.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/")
    if not token or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        return ""
    url = f"{api}/repos/{repo}/actions/workflows/release.yml/runs?status=success&per_page=1"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "demox-release",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body = json.loads(res.read().decode())
    except Exception:
        print("查询最近成功的 release 运行失败", file=sys.stderr)
        return ""
    runs = body.get("workflow_runs") or []
    if not runs:
        return ""
    sha = str(runs[0].get("head_sha") or "")
    return sha if is_sha(sha) else ""


def changed_files(base):
    output = subprocess.check_output(["git", "diff", "--name-only", base, "HEAD"], text=True)
    return [line for line in output.splitlines() if line]


def self_test():
    index = classify(["scf-code/website-api/index.js"])
    assert index["function_api"] and index["website"] and not index["edge"] and not index["www"]
    tests = classify(["scf-code/website-api/index.test.cjs"])
    assert tests["function_api"] and not tests["website"]
    migration = classify(["scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql"])
    assert migration["function_api"] and not migration["website"]
    edge = classify(["edge-functions/subdomain-router.js"])
    assert edge == {"function_api": False, "website": False, "edge": True, "www": False}
    www = classify(["src/App.tsx", "tsconfig.app.json"])
    assert www["www"] and not www["function_api"]
    assert classify(["docs/release-automation.md"]) == {name: False for name in GROUPS}
    assert classify(["package.json"])["www"]
    lock = classify(["scripts/ci/unified-scf-package-lock.json"])
    assert lock["function_api"] and not lock["website"] and not lock["www"]
    assert classify(["scripts/ci/www-purge.cjs"])["www"] and not classify(["scripts/ci/www-purge.cjs"])["edge"]
    assert classify(["scripts/ci/www-bundle.cjs"])["www"]
    website_script = classify(["scripts/ci/website-function-release.cjs"])
    assert website_script["website"] and not website_script["function_api"]
    for shared in SHARED_RELEASE:
        selected = classify([shared])
        assert selected == {name: True for name in GROUPS}
    assert "function_api=true\n" in format_outputs(index)
    old = "a" * 40
    mid = "b" * 40
    other = "c" * 40
    pairs = {(old, "HEAD"), (mid, "HEAD"), (old, mid)}

    def ancestor(older, newer="HEAD"):
        return older == newer or (older, newer) in pairs

    assert resolve_base(mid, old, ancestor) == old
    assert resolve_base(ZERO_SHA, old, ancestor) == old
    assert resolve_base("", "", ancestor) == "HEAD^"
    assert resolve_base(mid, "", ancestor) == mid
    assert resolve_base(other, old, ancestor) == old
    assert resolve_base(other, "", ancestor) == "HEAD^"
    assert resolve_base(old, old, ancestor) == old
    print("release-changes self-test OK")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    event = argv[1] if len(argv) > 1 else os.environ.get("EVENT_NAME", "")
    if event == "workflow_dispatch":
        selected = {name: True for name in GROUPS}
    else:
        before = os.environ.get("RELEASE_BEFORE", "")
        last = last_successful_sha()
        base = resolve_base(before, last, is_ancestor)
        print(f"release diff base {base}", file=sys.stderr)
        selected = classify(changed_files(base))
    sys.stdout.write(format_outputs(selected))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""website 函数要不要发布。

GitHub 的 paths 不能排除子路径。命中范围是 scf-code/website-api/**，
再去掉测试和 migrations/，并加上 scripts/ci/website-function-release.cjs
和 deploy-website-function.yml。
"""
import os
import re
import subprocess
import sys

PREFIX = "scf-code/website-api/"
RELEASE_SCRIPT = "scripts/ci/website-function-release.cjs"
WORKFLOW = ".github/workflows/deploy-website-function.yml"
TEST_RE = re.compile(r"(^|/)[^/]+\.test\.(cjs|js|mjs|ts)$")
ZERO_SHA = "0" * 40


def is_website_release(path):
    if path in (RELEASE_SCRIPT, WORKFLOW):
        return True
    if not path.startswith(PREFIX):
        return False
    rel = path[len(PREFIX):]
    if rel == "migrations" or rel.startswith("migrations/"):
        return False
    if TEST_RE.search(rel):
        return False
    return True


def wants_release(paths):
    return any(is_website_release(path) for path in paths)


def diff_names(base):
    proc = subprocess.run(
        ["git", "diff", "--name-only", base, "HEAD"],
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    return [line for line in proc.stdout.splitlines() if line]


def resolve_release(base):
    """未知或全零的 base 按要发布处理，避免漏发。"""
    text = (base or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{40}", text) or text == ZERO_SHA:
        return True
    names = diff_names(text)
    if names is None:
        return True
    return wants_release(names)


def self_test():
    assert is_website_release("scf-code/website-api/index.js")
    assert is_website_release("scf-code/website-api/shared/db.js")
    assert is_website_release("scf-code/website-api/package-lock.json")
    assert not is_website_release("scf-code/website-api/index.test.cjs")
    assert not is_website_release("scf-code/website-api/shared/jwt.test.cjs")
    assert not is_website_release("scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql")
    assert is_website_release(RELEASE_SCRIPT)
    assert is_website_release(WORKFLOW)
    assert not is_website_release("scripts/ci/website-function-release.test.cjs")
    assert not is_website_release("docs/release-automation.md")
    assert wants_release(["scf-code/website-api/index.test.cjs", "scf-code/website-api/index.js"])
    assert not wants_release([
        "scf-code/website-api/index.test.cjs",
        "scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql",
    ])
    assert resolve_release("") is True
    assert resolve_release(ZERO_SHA) is True
    print("WEBSITE PATHS SELF-TEST OK")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    release = resolve_release(os.environ.get("RELEASE_BASE", "HEAD^"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as handle:
            handle.write(f"release={'true' if release else 'false'}\n")
    print("website release" if release else "website skip")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Decide which release stages a master push should run.

Path lists match the filters the child workflows used before release.yml
became the only push trigger. Keep them together.
"""

import fnmatch
import subprocess
import sys

GROUPS = {
    "function_api": [
        "scf-code/function-api/**",
        "scf-code/website-api/**",
        "scf-code/mcp-api/**",
        "scf-code/cert-renew/**",
        "scf-deploy-packages/auth-api/**",
        "scripts/package-unified-scf.mjs",
        "scripts/ci/scf-function-api.cjs",
        "scripts/ci/function-api-release.cjs",
        ".github/workflows/deploy-function-api.yml",
    ],
    "website": [
        "scf-code/website-api/index.js",
        "scf-code/website-api/project-data.js",
        "scf-code/website-api/package.json",
        "scf-code/website-api/package-lock.json",
        "scf-code/website-api/shared/blocked-phrases.json",
        "scf-code/website-api/shared/buckets.js",
        "scf-code/website-api/shared/content-scan.js",
        "scf-code/website-api/shared/cookie-domain-policy.cjs",
        "scf-code/website-api/shared/crypto.js",
        "scf-code/website-api/shared/db.js",
        "scf-code/website-api/shared/deploy-upload.js",
        "scf-code/website-api/shared/feishu-directory.js",
        "scf-code/website-api/shared/github-directory.js",
        "scf-code/website-api/shared/jwt.js",
        "scf-code/website-api/shared/membership.js",
        "scf-code/website-api/shared/storage.js",
        ".github/workflows/deploy-website-function.yml",
    ],
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
        for name, patterns in GROUPS.items():
            if any(matches(path, pattern) for pattern in patterns):
                selected[name] = True
    return selected


def format_outputs(selected):
    return "".join(f"{name}={'true' if selected[name] else 'false'}\n" for name in GROUPS)


def changed_files():
    output = subprocess.check_output(["git", "diff", "--name-only", "HEAD^", "HEAD"], text=True)
    return [line for line in output.splitlines() if line]


def self_test():
    index = classify(["scf-code/website-api/index.js"])
    assert index["function_api"] and index["website"] and not index["edge"] and not index["www"]
    tests = classify(["scf-code/website-api/index.test.cjs"])
    assert tests["function_api"] and not tests["website"]
    edge = classify(["edge-functions/subdomain-router.js"])
    assert edge == {"function_api": False, "website": False, "edge": True, "www": False}
    www = classify(["src/App.tsx", "tsconfig.app.json"])
    assert www["www"] and not www["function_api"]
    assert classify(["docs/release-automation.md"]) == {name: False for name in GROUPS}
    assert classify(["package.json"])["www"]
    assert "function_api=true\n" in format_outputs(index)
    print("release-changes self-test OK")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    event = argv[1] if len(argv) > 1 else ""
    selected = {name: True for name in GROUPS} if event == "workflow_dispatch" else classify(changed_files())
    sys.stdout.write(format_outputs(selected))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

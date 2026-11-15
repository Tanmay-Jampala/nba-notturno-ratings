"""Run the data update from your own machine (use this if NBA.com blocks GitHub's runners).

    python scripts/update_local.py            # fetch → compute → test → commit → push
    python scripts/update_local.py --no-push  # stop after committing

Pushing data/ to main triggers deploy.yml, which rebuilds and redeploys the site.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NPX = "npx.cmd" if sys.platform == "win32" else "npx"


def run(cmd: list[str]) -> int:
    print("$", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=ROOT)


def main() -> int:
    # the scheduled GitHub job also commits data/, so start from the latest main
    if run(["git", "pull", "--rebase", "--autostash", "-q"]) != 0:
        print("git pull failed; not updating.")
        return 1
    if run([sys.executable, "scripts/fetch.py", "--source", "stats", "--label", "local"]) != 0:
        print("Fetch failed; nothing changed.")
        return 1
    if run([NPX, "tsx", "scripts/compute.ts"]) != 0 or run([NPX, "vitest", "run"]) != 0:
        print("Compute or tests failed; restoring the previous data.")
        run(["git", "checkout", "--", "data", "public/data"])
        return 1
    run(["git", "add", "data/raw/bundle.json", "public/data"])
    if subprocess.call(["git", "diff", "--cached", "--quiet"], cwd=ROOT) == 0:
        print("No data changes.")
        return 0
    run(["git", "commit", "-m", "data: local update"])
    if "--no-push" in sys.argv:
        return 0
    if run(["git", "push", "-q"]) == 0:
        return 0
    # GitHub's job pushed in the meantime: replay ours on top, preferring our (full stats.nba.com) data
    print("Push rejected; rebasing onto the latest main and retrying.")
    if run(["git", "pull", "--rebase", "-X", "theirs", "-q"]) != 0:
        run(["git", "rebase", "--abort"])
        return 1
    run([NPX, "tsx", "scripts/compute.ts"])
    run(["git", "add", "public/data"])
    if subprocess.call(["git", "diff", "--cached", "--quiet"], cwd=ROOT) != 0:
        run(["git", "commit", "-q", "-m", "data: recompute after rebase"])
    return run(["git", "push", "-q"])


if __name__ == "__main__":
    sys.exit(main())

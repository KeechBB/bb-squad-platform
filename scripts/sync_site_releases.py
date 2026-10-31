#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild src/data/site-releases.json from docs/CHANGELOG.md."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "docs" / "CHANGELOG.md"
OUT = ROOT / "src" / "data" / "site-releases.json"


def main() -> None:
    text = CHANGELOG.read_text(encoding="utf-8")
    parts = re.split(r"(?m)^## v\. ", text)
    releases: list[dict] = []
    for part in parts[1:]:
        m = re.match(
            r"(\d+\.\d+\.\d+)\s*—\s*(\d{2})\.(\d{2})\.(\d{4})\s*·\s*(.+)\n",
            part,
        )
        if not m:
            continue
        ver, dd, mm, yyyy, title = m.groups()
        date = f"{yyyy}-{mm}-{dd}"
        bullets: list[str] = []
        code = re.search(r"```(.*?)```", part, re.S)
        body = code.group(1) if code else part
        for line in body.splitlines():
            line = line.strip()
            bm = re.match(r"^\d+\.\s+(.+)$", line)
            if bm:
                bullets.append(bm.group(1).strip())
        if not bullets:
            bullets = [title.strip()]
        releases.append(
            {
                "version": ver,
                "date": date,
                "title": title.strip(),
                "bullets": bullets[:8],
            }
        )

    old = json.loads(OUT.read_text(encoding="utf-8"))
    parsed = {r["version"] for r in releases}
    for r in old.get("releases") or []:
        if r.get("version") not in parsed:
            releases.append(r)

    def sort_key(r: dict) -> tuple:
        parts_v = [int(x) for x in str(r.get("version") or "0.0.0").split(".")]
        while len(parts_v) < 3:
            parts_v.append(0)
        return (r.get("date") or "", parts_v[0], parts_v[1], parts_v[2])

    releases.sort(key=sort_key, reverse=True)
    current = releases[0]["version"] if releases else "1.1.133"
    out = {"current": current, "releases": releases}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"current={current} releases={len(releases)}")
    print("top5", [r["version"] for r in releases[:5]])


if __name__ == "__main__":
    main()

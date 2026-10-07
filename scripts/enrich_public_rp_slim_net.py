#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add per-match `net` into slim public rp-ladder.json from full ledger (RAM-careful)."""
from __future__ import annotations

import json
import os
from pathlib import Path

CANDS = [
    Path(os.environ.get("BB_KV_PUBLIC", "")) / "data" / "public",
    Path("/var/www/blackberry-kv/data/public"),
    Path("/var/www/bb-squad-platform/data/kv-cache/data/public"),
    Path(__file__).resolve().parents[2] / "KV" / "public" / "data" / "public",
    Path(__file__).resolve().parents[1] / "data" / "kv-cache" / "data" / "public",
]


def resolve_dir() -> Path:
    for c in CANDS:
        if c and (c / "rp-ladder.json").is_file():
            return c
    raise SystemExit("public rp-ladder.json not found")


def main() -> None:
    d = resolve_dir()
    ladder_p = d / "rp-ladder.json"
    ledger_p = d / "rp-ledger.json"
    if not ledger_p.is_file():
        raise SystemExit(f"missing {ledger_p}")

    print(f"enrich slim from {ledger_p}", flush=True)
    ledger = json.loads(ledger_p.read_text(encoding="utf-8"))
    net_by: dict[str, dict[str, float]] = {}
    for key, p in (ledger.get("players") or {}).items():
        mnets: dict[str, float] = {}
        for m in p.get("matches") or []:
            mid = str(m.get("id") or "")
            if not mid:
                continue
            mnets[mid] = float(m.get("net") or 0)
        if mnets:
            net_by[str(key).lower()] = mnets
            nick = str(p.get("nick") or "").strip().lower().replace(" ", "")
            if nick:
                net_by[nick] = mnets

    slim = json.loads(ladder_p.read_text(encoding="utf-8"))
    n = 0
    for key, p in (slim.get("players") or {}).items():
        kn = str(key).lower()
        nick = str(p.get("nick") or "").strip().lower().replace(" ", "")
        mnets = net_by.get(kn) or net_by.get(nick) or {}
        for m in p.get("matches") or []:
            mid = str(m.get("id") or "")
            if mid in mnets:
                m["net"] = round(mnets[mid], 1)
                n += 1
    slim["slim"] = True
    text = json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n"
    ladder_p.write_text(text, encoding="utf-8")
    # mirrors
    for mirror in (
        Path("/var/www/bb-squad-platform/data/kv-cache/data/public/rp-ladder.json"),
        Path("/var/www/bb-squad-platform/data/public/rp-ladder.json"),
    ):
        if mirror.resolve() == ladder_p.resolve():
            continue
        try:
            mirror.parent.mkdir(parents=True, exist_ok=True)
            mirror.write_text(text, encoding="utf-8")
            print(f"mirrored {mirror}", flush=True)
        except OSError as e:
            print(f"skip mirror {mirror}: {e}", flush=True)
    print(f"Wrote {ladder_p} nets={n} players={len(slim.get('players') or {})}")


if __name__ == "__main__":
    main()

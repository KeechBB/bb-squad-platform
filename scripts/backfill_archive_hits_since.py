#!/usr/bin/env python3
"""Добор попаданий BBHitZone в профиль с 20.10 МСК.

Только архив: {BB_LOG_ARCHIVE}/TR*/_live/SquadGame.log и
TR*/YYYY-MM/SquadGame-backup-*.log.
Булавки, рабочие копии и срезы matches/ не читаем — это те же байты.

Повторный запуск не двоит: тот же ключ база отклоняет.
Вторая строка в ту же секунду пишется с миллисекундами из лога.
Пустой VictimEOS тоже считается попаданием.
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE = Path("/var/www/bb-squad-logs")
# 20.10.2026 00:00 МСК = 19.10 21:00 UTC
SINCE = "2026.10.19-21.00.00"
ENVS = [
    Path("/var/www/bb-squad-platform/scripts/.squad-collector.env"),
    Path("/var/www/bb-squad-platform/.env"),
]
HIT_RE = re.compile(
    r"BBHitZone:\s*"
    r"AttackerEOS=<?(?P<aeos>[0-9a-fA-F]{32}|none)>?\s+"
    r"(?:AttackerSteam=<?(?P<asteam>7656\d{13}|none)>?\s+)?"
    r"VictimEOS=<?(?P<veos>[0-9a-fA-F]{32}|none|)?>?\s+"
    r"Zone=<?(?P<zone>[^>\s]+)>?\s+"
    r"Damage=<?(?P<damage>[^>\s]+)>?\s+"
    r"Bone=<?(?P<bone>[^>\s]+)>?"
    r"(?:\s+Weapon=<?(?P<weapon>[^>\s]+)>?)?",
    re.I,
)
LINE_TS = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):(?P<ms>\d+)\]"
)
STEAM_EOS = re.compile(
    r"EOS:\s*([0-9a-fA-F]{32}).*?steam:\s*(7656\d{13})"
    r"|steam:\s*(7656\d{13}).*?EOS:\s*([0-9a-fA-F]{32})",
    re.I,
)
POST_SERVERS = {"TR1", "TR2"}


def env_get(key: str) -> str:
    for p in ENVS:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == key:
                return v.strip().strip('"').strip("'")
    return ""


def archive_logs() -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for srv in ("TR1", "TR2", "TR3", "TR4", "TR5"):
        base = ARCHIVE / srv
        if not base.is_dir():
            continue
        live = base / "_live" / "SquadGame.log"
        if live.is_file():
            out.append((srv, live))
        for month in sorted(p for p in base.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}", p.name)):
            plain = list(month.glob("SquadGame-backup-*.log"))
            names = {p.name for p in plain}
            files = list(plain)
            for gz in month.glob("SquadGame-backup-*.log.gz"):
                if gz.name[:-3] not in names:
                    files.append(gz)
            for f in files:
                m = re.search(r"(20\d{2})\.(\d{2})\.(\d{2})", f.name)
                if m and f"{m.group(1)}.{m.group(2)}.{m.group(3)}" < "2026.10.19":
                    continue
                out.append((srv, f))
    return out


def open_log(path: Path):
    if path.suffix == ".gz":
        import gzip
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def collect(srv: str, path: Path) -> list[dict]:
    eos_steam: dict[str, str] = {}
    events: list[dict] = []
    seen: dict[tuple, int] = {}
    with open_log(path) as fh:
        for line in fh:
            sm = STEAM_EOS.search(line)
            if sm:
                if sm.group(1) and sm.group(2):
                    eos_steam[sm.group(1).lower()] = sm.group(2)
                elif sm.group(3) and sm.group(4):
                    eos_steam[sm.group(4).lower()] = sm.group(3)
            tm = LINE_TS.match(line)
            hm = HIT_RE.search(line)
            if not tm or not hm:
                continue
            if tm.group("ts") < SINCE:
                continue
            bone = (hm.group("bone") or "").strip()
            if not bone or bone.lower() == "none":
                continue
            aeos = (hm.group("aeos") or "").strip().lower()
            if aeos == "none":
                aeos = ""
            asteam = (hm.group("asteam") or "").strip()
            if not asteam.startswith("7656"):
                asteam = eos_steam.get(aeos, "") if aeos else ""
            if not aeos and not asteam:
                continue
            veos = (hm.group("veos") or "").strip().lower()
            if veos == "none":
                veos = ""
            stamp = datetime.strptime(tm.group("ts"), "%Y.%m.%d-%H.%M.%S").replace(
                tzinfo=timezone.utc
            )
            at = stamp.strftime("%Y-%m-%dT%H:%M:%S")
            key = (
                aeos,
                asteam,
                veos,
                bone,
                hm.group("damage") or "",
                hm.group("weapon") or "",
                at,
            )
            n = seen.get(key, 0)
            seen[key] = n + 1
            if n:
                ms = int(tm.group("ms") or "0") % 1000
                frac = (ms + n) % 1000
                at_iso = f"{at}.{frac:03d}Z"
            else:
                at_iso = at + "Z"
            events.append(
                {
                    "type": "hit",
                    "steamId": asteam or "",
                    "eosId": aeos or None,
                    "victimEos": veos or None,
                    "zone": (hm.group("zone") or "Limb").strip(),
                    "bone": bone,
                    "damage": (hm.group("damage") or "").strip() or None,
                    "weapon": (hm.group("weapon") or "").strip() or None,
                    "at": at_iso,
                    "serverKey": srv,
                }
            )
    return events


def post(secret: str, events: list[dict]) -> tuple[int, int]:
    accepted = skipped = 0
    url = "http://127.0.0.1:3000/api/ingest/squad-hits"
    for i in range(0, len(events), 400):
        part = events[i : i + 400]
        req = urllib.request.Request(
            url,
            data=json.dumps({"events": part}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        accepted += int(data.get("accepted") or 0)
        skipped += int(data.get("skipped") or 0)
        print(f"  chunk {i // 400 + 1} accepted {data.get('accepted')} skipped {data.get('skipped')}", flush=True)
    return accepted, skipped


def main() -> None:
    secret = env_get("SQUAD_INGEST_SECRET")
    if not secret:
        raise SystemExit("no ingest secret")
    total_acc = total_skip = 0
    other = {}
    for srv, path in archive_logs():
        events = collect(srv, path)
        print(f"{srv} {path.name} lines {len(events)}", flush=True)
        if srv not in POST_SERVERS:
            other[srv] = other.get(srv, 0) + len(events)
            continue
        if not events:
            continue
        acc, skip = post(secret, events)
        total_acc += acc
        total_skip += skip
    print("done accepted", total_acc, "skipped", total_skip, "other_servers", other)


if __name__ == "__main__":
    main()

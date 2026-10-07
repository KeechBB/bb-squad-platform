#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-digitize TR1 training matches from logs → KV training JSON + auto MATCHES for RP.

Canon: .cursor/rules/tr1-pb1-auto-canon.mdc
- start 21:30–00:00 MSK, not Jensen*, layer >10 min, only after map end
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rp_log_parse as R  # noqa: E402


def _resolve_kv_public() -> Path:
    """
    Where training JSON lives.
    Local monorepo: <project>/KV/public
    VPS: /var/www/blackberry-kv or platform data/kv-cache
    """
    env = (os.environ.get("BB_KV_PUBLIC") or os.environ.get("KV_LOCAL_DIR") or "").strip()
    cands: list[Path] = []
    if env:
        p = Path(env)
        cands += [p, p / "public"]
    cands += [
        Path("/var/www/blackberry-kv"),
        Path("/var/www/bb-squad-platform/data/kv-cache"),
        HERE.parents[1] / "KV" / "public",  # monorepo: .../Новый Проект Кича/KV/public
        HERE.parents[0] / "data" / "kv-cache",  # platform/data/kv-cache
    ]
    for c in cands:
        try:
            if (c / "data" / "training").is_dir() or (c / "data" / "tiers.json").is_file():
                return c
        except OSError:
            continue
    # last resort: create monorepo-style path
    fallback = HERE.parents[1] / "KV" / "public"
    (fallback / "data" / "training" / "players").mkdir(parents=True, exist_ok=True)
    return fallback


KV_PUBLIC = _resolve_kv_public()
TRAIN = KV_PUBLIC / "data" / "training"
PLAYERS = TRAIN / "players"
INDEX = KV_PUBLIC / "data" / "training-index.json"
AUTO_MATCHES = TRAIN / "_auto_matches.json"
CACHE = Path(os.environ.get("TR1_LOG_CACHE", str(HERE / "_tmp_tr1_logs_cache")))
LOOKBACK_DAYS = int(os.environ.get("TR1_LOOKBACK_DAYS", "3"))
print(f"KV_PUBLIC={KV_PUBLIC}", flush=True)


def _load_collector_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for p in (
        HERE / ".squad-collector.env.run",
        HERE / ".squad-collector.env",
        HERE.parent / ".env",
    ):
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in out:
                out[k] = v
                os.environ.setdefault(k, v)
    return out


def sync_tr_server_logs_via_ssh(server_key: str = "TR1") -> list[Path]:
    """Download SquadGame.log + recent backups for TR1 or TR2."""
    env = _load_collector_env()
    cache = (
        CACHE
        if server_key == "TR1"
        else Path(os.environ.get("TR2_LOG_CACHE", str(HERE / "_tmp_tr2_logs_cache")))
    )
    try:
        import paramiko
    except ImportError as e:
        local = sorted(cache.glob("*.log"))
        if local:
            print(f"paramiko missing ({e}) — using local {server_key} cache", flush=True)
            return local
        print(f"paramiko missing and no {server_key} cache: {e}", flush=True)
        return []

    host = env.get("SQUAD_SSH_HOST")
    user = env.get("SQUAD_SSH_USER")
    password = env.get("SQUAD_SSH_PASSWORD")
    if not host or not user or not password:
        print(f"SSH env missing — using local {server_key} cache only", flush=True)
        return sorted(cache.glob("*.log"))

    import time

    port = int(env.get("SQUAD_SSH_PORT") or "2022")
    root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
    remote_dir = f"{root}/{server_key}/SquadGame/Saved/Logs"
    cache.mkdir(parents=True, exist_ok=True)

    last_err: Exception | None = None
    for attempt in range(4):
        transport = None
        try:
            transport = paramiko.Transport((host, port))
            transport.banner_timeout = 120
            transport.connect(username=user, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            assert sftp is not None
            names = sftp.listdir(remote_dir)
            backups = sorted(
                [
                    n
                    for n in names
                    if n.startswith("SquadGame-backup-") and n.endswith(".log")
                ],
                reverse=True,
            )[:3]
            for name in ["SquadGame.log"] + backups:
                rpath = f"{remote_dir}/{name}"
                # Avoid TR1/TR2 overwriting same SquadGame.log name in shared caches
                local_name = (
                    name
                    if server_key == "TR1"
                    else f"{server_key}-{name}"
                )
                lpath = cache / local_name
                try:
                    st = sftp.stat(rpath)
                    if lpath.is_file() and lpath.stat().st_size == st.st_size:
                        continue
                    print(f"{server_key} sftp ← {name} ({st.st_size})", flush=True)
                    sftp.get(rpath, str(lpath))
                except Exception as e:
                    print(f"{server_key} skip {name}: {e}", flush=True)
            sftp.close()
            transport.close()
            break
        except Exception as e:
            last_err = e
            print(f"{server_key} ssh fail {attempt+1}: {type(e).__name__}: {e}", flush=True)
            try:
                if transport:
                    transport.close()
            except Exception:
                pass
            time.sleep(2 + attempt)
    else:
        print(f"{server_key} ssh gave up: {last_err}", flush=True)

    return sorted(cache.glob("*.log"))


def sync_tr1_logs_via_ssh() -> list[Path]:
    """TR1 + TR2 (паритет учёта)."""
    logs = sync_tr_server_logs_via_ssh("TR1")
    try:
        logs = list(logs) + list(sync_tr_server_logs_via_ssh("TR2"))
    except Exception as e:
        print(f"TR2 sync optional fail: {e}", flush=True)
    return logs

def msk_hour_ok(start_utc: datetime) -> bool:
    msk = start_utc + timedelta(hours=3)
    minutes = msk.hour * 60 + msk.minute
    # 21:30 inclusive .. 24:00 exclusive
    return 21 * 60 + 30 <= minutes < 24 * 60


def match_id_for(m: dict, *, used_ids: set[str] | None = None) -> str:
    """Stable id; if same map already used that day, append -2, -3, …"""
    msk = m["start"] + timedelta(hours=3)
    day = msk.day
    layer = str(m.get("layer") or m.get("map") or "map")
    # Stable short id: "Al Basrah RAAS v3" → albasrah, "Sumari Bala AAS v1" → sumari
    base = re.sub(r"\b(raas|aas|invasion|tc|skirmish)\b.*$", "", layer, flags=re.I)
    base = re.sub(r"\s*v\d+\s*$", "", base, flags=re.I)
    slug = re.sub(r"[^a-z0-9]+", "", base.lower())[:14] or "map"
    primary = f"{day:02d}-{slug}"
    used = used_ids or set()
    if primary not in used:
        return primary
    n = 2
    while f"{primary}-{n}" in used:
        n += 1
    return f"{primary}-{n}"


def _map_stem(layer: str) -> str:
    base = re.sub(r"\b(raas|aas|invasion|tc|skirmish)\b.*$", "", layer or "", flags=re.I)
    base = re.sub(r"\s*v\d+\s*$", "", base, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", base.lower())


def existing_match_starts() -> set[str]:
    """ISO start timestamps already recorded in _auto_matches — true dedupe."""
    out: set[str] = set()
    if AUTO_MATCHES.is_file():
        try:
            auto = json.loads(AUTO_MATCHES.read_text(encoding="utf-8"))
            if isinstance(auto, list):
                for row in auto:
                    s = str(row.get("start") or "").strip()
                    if s:
                        out.add(s)
        except Exception:
            pass
    return out


def layer_mode(layer: str) -> str:
    """Canon: CSL* → Skirmish; else AAS/RAAS from layer name."""
    u = (layer or "").upper()
    if "CSL" in u:
        return "Skirmish"
    if "RAAS" in u:
        return "RAAS"
    if "AAS" in u:
        return "AAS"
    if "SKIRMISH" in u:
        return "Skirmish"
    return "—"


def existing_month_ids() -> set[str]:
    ids: set[str] = set()
    for path in TRAIN.glob("????-??.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in data.get("matches") or []:
            mid = str(row.get("id") or "").strip()
            if mid:
                ids.add(mid)
    return ids


def existing_start_anchors() -> list[tuple[int, str, datetime]]:
    """(day, mapStem, start_utc) from month JSON + auto — near-duplicate guard."""
    anchors: list[tuple[int, str, datetime]] = []
    for path in TRAIN.glob("????-??.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        month = str(data.get("month") or path.stem)  # YYYY-MM
        try:
            y, mo = map(int, month.split("-")[:2])
        except Exception:
            continue
        for row in data.get("matches") or []:
            day = int(row.get("day") or 0)
            stem = _map_stem(str(row.get("map") or ""))
            tm = str(row.get("timeMsk") or "").strip()
            if not (day and stem and tm and ":" in tm):
                continue
            try:
                hh, mm = map(int, tm.split(":")[:2])
                # timeMsk is Moscow wall clock → convert to UTC
                start_utc = datetime(y, mo, day, hh, mm, tzinfo=timezone.utc) - timedelta(
                    hours=3
                )
            except Exception:
                continue
            anchors.append((day, stem, start_utc))
    if AUTO_MATCHES.is_file():
        try:
            auto = json.loads(AUTO_MATCHES.read_text(encoding="utf-8"))
        except Exception:
            auto = []
        if isinstance(auto, list):
            for row in auto:
                s = str(row.get("start") or "").strip()
                if not s:
                    continue
                try:
                    start = datetime.fromisoformat(s.replace("Z", "+00:00"))
                    if start.tzinfo is None:
                        start = start.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                msk = start + timedelta(hours=3)
                stem = _map_stem(str(row.get("map") or ""))
                if stem:
                    anchors.append((msk.day, stem, start))
    return anchors


def is_near_duplicate(
    day: int,
    stem: str,
    start: datetime,
    anchors: list[tuple[int, str, datetime]],
    *,
    window_sec: int = 3 * 60,
) -> bool:
    """Same map rediscovery only (same start ±3 мин). Две одинаковые карты за вечер — обе."""
    for d, st, t0 in anchors:
        if d != day or st != stem:
            continue
        if abs((start - t0).total_seconds()) <= window_sec:
            return True
    return False


def load_aliases() -> dict[str, str]:
    tiers = KV_PUBLIC / "data" / "tiers.json"
    if not tiers.is_file():
        # monorepo fallback
        tiers = HERE.parents[1] / "KV" / "public" / "data" / "tiers.json"
    out: dict[str, str] = {}
    if tiers.is_file():
        t = json.loads(tiers.read_text(encoding="utf-8"))
        for a, c in (t.get("aliases") or {}).items():
            out[R.nick_key(str(a))] = R.nick_key(str(c))
    return out


def agg_players(
    dies: list[dict],
    wounds: list[dict],
    revives: list[dict],
    teams: dict[str, str],
    disp: dict[str, str],
) -> tuple[list[dict], list[dict]]:
    """Build teamA/teamB rows from combat logs."""
    stats: dict[str, dict] = {}

    def row(k: str, nick: str) -> dict:
        if k not in stats:
            stats[k] = {
                "nick": nick,
                "res": 0,
                "nok": 0,
                "kills": 0,
                "deaths": 0,
                "dmg": 0,
                "team": teams.get(k),
            }
        return stats[k]

    for w in wounds:
        kk, vk = w.get("killerKey"), w.get("victimKey")
        if not kk or not vk or kk == vk:
            continue
        row(kk, w.get("killer") or disp.get(kk, kk))["nok"] += 1
        row(kk, w.get("killer") or kk)["dmg"] += float(w.get("dmg") or 0)
        row(vk, w.get("victim") or disp.get(vk, vk))
        if kk in teams and vk in teams and teams[kk] == teams[vk]:
            pass  # TK nok still counts as nok for killer

    for d in dies:
        kk, vk = d.get("killerKey"), d.get("victimKey")
        if not kk or not vk or kk == vk:
            continue
        r_k = row(kk, d.get("killer") or disp.get(kk, kk))
        r_v = row(vk, d.get("victim") or disp.get(vk, vk))
        same = kk in teams and vk in teams and teams[kk] == teams[vk]
        if not same:
            r_k["kills"] += 1
            r_k["dmg"] += float(d.get("dmg") or 0)
        r_v["deaths"] += 1

    for r in revives:
        kk = R.canon_key(r.get("killer") or "", {})
        if not kk:
            continue
        row(kk, r.get("killer") or kk)["res"] += 1

    a, b = [], []
    for k, s in stats.items():
        s["dmg"] = int(round(s["dmg"]))
        team = s.pop("team", None)
        if team == "2":
            b.append(s)
        else:
            a.append(s)
    a.sort(key=lambda x: (-x["kills"], -x["nok"], x["nick"].lower()))
    b.sort(key=lambda x: (-x["kills"], -x["nok"], x["nick"].lower()))
    return a, b


def publish_live_mirrors() -> None:
    """Copy training outputs into VPS kv-cache so /tm sees them without waiting for Pages."""
    mirrors: list[Path] = []
    for raw in (
        os.environ.get("KV_LOCAL_DIR", "").strip(),
        "/var/www/bb-squad-platform/data/kv-cache",
        str(HERE.parents[0] / "data" / "kv-cache"),
    ):
        if not raw:
            continue
        p = Path(raw)
        if p.resolve() == KV_PUBLIC.resolve():
            continue
        if (p / "data").is_dir() or p.is_dir():
            mirrors.append(p)
    if not mirrors:
        return
    import shutil

    rels = [
        "data/cache-bust.json",
        "data/training/2026-10.json",
        "data/training/_auto_matches.json",
        "data/training/rp-ledger.json",
        "data/training/rp-ladder.json",
        "data/training-index.json",
        "app.js",
    ]
    # also newest player files referenced by month
    try:
        month = json.loads((TRAIN / "2026-10.json").read_text(encoding="utf-8"))
        for m in month.get("matches") or []:
            pu = str(m.get("playersUrl") or "")
            if pu.startswith("data/"):
                rels.append(pu)
    except Exception:
        pass
    # all current-month training JSON if present
    for path in TRAIN.glob("????-??.json"):
        rels.append(f"data/training/{path.name}")
    for dest_root in mirrors:
        for rel in rels:
            src = KV_PUBLIC / rel
            if not src.is_file():
                continue
            dst = dest_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        print(f"mirrored train data → {dest_root}", flush=True)


def bump_cache_bust() -> None:
    """Bump training-index bust + app.js DATA_VER + cache-bust.json for /tm /cw."""
    from datetime import datetime as _dt

    tag = _dt.now().strftime("%Y%m%d-%H%M")
    bust_doc = {
        "bust": tag,
        "updatedAt": _dt.now(timezone.utc).isoformat(),
        "note": "Пишет sync_train / collector — Next /tm /cw читают live без redeploy",
    }
    try:
        (KV_PUBLIC / "data" / "cache-bust.json").write_text(
            json.dumps(bust_doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"cache-bust.json → {tag}", flush=True)
    except Exception as e:
        print(f"cache-bust fail: {e}", flush=True)

    if INDEX.is_file():
        try:
            idx = json.loads(INDEX.read_text(encoding="utf-8"))
            idx["bust"] = tag
            INDEX.write_text(
                json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        except Exception as e:
            print(f"index bust fail: {e}", flush=True)
    app = KV_PUBLIC / "app.js"
    if app.is_file():
        try:
            text = app.read_text(encoding="utf-8")
            import re as _re

            text2, n = _re.subn(
                r'(DATA_VER\s*=\s*new URLSearchParams\(location\.search\)\.get\("v"\)\s*\|\|\s*")([^"]+)(")',
                rf"\g<1>{tag}\3",
                text,
                count=1,
            )
            if n:
                app.write_text(text2, encoding="utf-8")
                print(f"app.js DATA_VER → {tag}", flush=True)
        except Exception as e:
            print(f"app.js bust fail: {e}", flush=True)


def upsert_month(match_meta: dict) -> None:
    month = match_meta["month"]  # YYYY-MM
    path = TRAIN / f"{month}.json"
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        data = {
            "month": month,
            "title": f"BlackBerry — тренировочные матчи · {month}",
            "note": "Авто из логов TR1 (21:30–00:00 МСК, не Jensen*).",
            "matches": [],
        }
    matches = data.setdefault("matches", [])
    mid = match_meta["id"]
    matches = [m for m in matches if m.get("id") != mid]
    matches.append(match_meta["row"])
    matches.sort(key=lambda m: (m.get("day") or 0, m.get("timeMsk") or ""))
    data["matches"] = matches
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if INDEX.is_file():
        idx = json.loads(INDEX.read_text(encoding="utf-8"))
    else:
        idx = {"months": []}
    months = idx.setdefault("months", [])
    url = f"data/training/{month}.json"
    if not any(m.get("url") == url or m.get("id") == month for m in months):
        y, mo = month.split("-")
        months.insert(
            0,
            {
                "id": month,
                "year": int(y),
                "month": int(mo),
                "label": month,
                "url": url,
            },
        )
        INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def reconcile_orphan_player_files() -> int:
    """
    If players/{id}.json exists but month JSON lost the row (rsync/github wipe),
    restore the calendar row from the players doc. Prevents silent gaps like 06-cslmutaha.
    """
    auto_by_id: dict[str, dict] = {}
    if AUTO_MATCHES.is_file():
        try:
            for am in json.loads(AUTO_MATCHES.read_text(encoding="utf-8")) or []:
                mid0 = str(am.get("id") or "")
                if mid0 and not am.get("skip"):
                    auto_by_id[mid0] = am
        except Exception:
            pass

    present: set[str] = set()
    for month_path in TRAIN.glob("????-??.json"):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for x in data.get("matches") or []:
            mid0 = str(x.get("id") or "")
            if mid0:
                present.add(mid0)

    restored = 0
    for path in sorted(PLAYERS.glob("*.json")):
        mid = path.stem
        if mid.endswith("-skip") or mid.startswith("_") or mid in present:
            continue
        m = re.match(r"^(\d{1,2})-", mid)
        if not m:
            continue
        day = int(m.group(1))
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        time_msk = "—"
        month_key = None
        am = auto_by_id.get(mid)
        if am and am.get("start"):
            try:
                start = datetime.fromisoformat(str(am["start"]).replace("Z", "+00:00"))
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                msk = start + timedelta(hours=3)
                time_msk = msk.strftime("%H:%M")
                month_key = f"{msk.year:04d}-{msk.month:02d}"
            except Exception:
                pass
        if not month_key:
            # fallback: newest month file
            months = sorted(TRAIN.glob("????-??.json"), reverse=True)
            month_key = months[0].stem if months else None
        if not month_key:
            continue

        side_a = doc.get("sideA") or {}
        side_b = doc.get("sideB") or {}
        row = {
            "id": mid,
            "day": day,
            "timeMsk": time_msk,
            "map": doc.get("map") or "—",
            "mode": doc.get("mode") or layer_mode(str(doc.get("map") or "")),
            "size": "—",
            "server": doc.get("server") or "Blackberry | Training - Blackberries #1",
            "duration": doc.get("duration") or "—",
            "factionA": side_a.get("name") or "A",
            "ticketsA": int(side_a.get("tickets") or 0),
            "factionB": side_b.get("name") or "B",
            "ticketsB": int(side_b.get("tickets") or 0),
            "winner": doc.get("winner") or "—",
            "status": "done",
            "playersUrl": f"data/training/players/{mid}.json",
            "source": doc.get("source") or "tr1-logs-auto",
            "note": "reconcile orphan players JSON → month",
        }
        upsert_month({"id": mid, "month": month_key, "row": row})
        restored += 1
        print(f"reconcile +{mid} → {month_key}", flush=True)
    return restored


def main() -> int:
    aliases = load_aliases()
    print("=== sync TR1 logs ===", flush=True)
    n_rec = reconcile_orphan_player_files()
    if n_rec:
        print(f"reconciled orphan player files: {n_rec}", flush=True)
        bump_cache_bust()
    logs = sync_tr1_logs_via_ssh()
    if not logs:
        if not CACHE.is_dir():
            print(f"no cache {CACHE}", flush=True)
            return 0
        logs = sorted(CACHE.glob("*.log"))
    if not logs:
        print("no TR1 logs in cache", flush=True)
        return 0
    print(f"TR1 logs: {len(logs)} {[p.name for p in logs[:8]]}", flush=True)

    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    discovered = R.discover_matches(logs)
    auto: list[dict] = []
    if AUTO_MATCHES.is_file():
        try:
            auto = json.loads(AUTO_MATCHES.read_text(encoding="utf-8"))
            if not isinstance(auto, list):
                auto = []
        except Exception:
            auto = []
    known_ids = {m.get("id") for m in auto} | existing_month_ids()
    known_starts = existing_match_starts()
    anchors = existing_start_anchors()
    for m in auto:
        s = str(m.get("start") or "").strip()
        if s:
            known_starts.add(s)

    added = 0
    for m in discovered:
        start: datetime = m["start"]
        end: datetime = m["end"]
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
            end = end.replace(tzinfo=timezone.utc)
        if start < cutoff:
            continue
        if not msk_hour_ok(start):
            continue
        layer = str(m.get("layer") or m.get("map") or "")
        if R.is_seed_layer(layer, str(m.get("level") or "")):
            continue
        if (end - start).total_seconds() <= 10 * 60:
            continue

        start_iso = start.isoformat()
        if start_iso in known_starts:
            continue

        msk = start + timedelta(hours=3)
        stem = _map_stem(layer)
        # Same map rediscovery only (±3 мин). Две одинаковые карты за вечер — обе.
        if is_near_duplicate(msk.day, stem, start, anchors):
            continue

        mid = match_id_for(m, used_ids=known_ids)
        if mid in known_ids:
            continue

        log_path = Path(m["logPath"]) if m.get("logPath") else CACHE / m.get("log", "")
        if not log_path.is_file():
            continue
        idx = R.index_log_combat(log_path, aliases)
        steam = dict(idx.get("steam_to_nick") or {})
        faction_to_team = m.get("factionToTeam") or {}
        teams = R.teams_in_window(idx, start, end, faction_to_team)
        dies, _ = R.dies_in_window(idx, start, end, steam, aliases)
        wounds = R.wounds_in_window(idx, start, end, steam, aliases)
        revives = R.revives_in_window(idx, start, end)
        disp = {R.canon_key(n, aliases): n for n in steam.values()}
        team_a, team_b = agg_players(dies, wounds, revives, teams, disp)

        # Перекур / пустая катка: мало игроков или почти нет give-up (Yehorivka 06.10).
        n_players = len(team_a) + len(team_b)
        n_dies = len(dies) if isinstance(dies, list) else 0
        if n_players < 12 or n_dies < 25:
            auto.append(
                {
                    "id": f"{mid}-skip",
                    "map": layer,
                    "date": msk.strftime("%Y-%m-%d"),
                    "log": log_path.name,
                    "start": start_iso,
                    "end": end.isoformat(),
                    "skip": True,
                    "note": f"авто-skip перекур/тонкая катка (players={n_players}, dies={n_dies})",
                }
            )
            known_starts.add(start_iso)
            print(
                f"skip thin {layer} players={n_players} dies={n_dies} {start_iso}",
                flush=True,
            )
            continue

        month = f"{msk.year:04d}-{msk.month:02d}"
        dur_sec = int((end - start).total_seconds())
        h, rem = divmod(dur_sec, 3600)
        mi, s = divmod(rem, 60)
        duration = f"{h:02d}:{mi:02d}:{s:02d}" if h else f"{mi:02d}:{s:02d}"

        t1 = m.get("score1")
        t2 = m.get("score2")
        ftt = m.get("factionToTeam") or {}
        f1 = next((f for f, t in ftt.items() if str(t) == "1"), "A")
        f2 = next((f for f, t in ftt.items() if str(t) == "2"), "B")
        winner_team = str(m.get("winnerTeam") or "")
        winner = f1 if winner_team == "1" else f2 if winner_team == "2" else "—"

        log_name_l = log_path.name.upper()
        is_tr2 = "TR2" in log_name_l or "TR2" in str(log_path).upper()
        server_label = (
            "Blackberry | Training - Blackberries #2"
            if is_tr2
            else "Blackberry | Training - Blackberries #1"
        )
        players_doc = {
            "matchId": mid,
            "map": layer,
            "mode": layer_mode(layer),
            "server": server_label,
            "duration": duration,
            "winner": winner,
            "sideA": {"name": f1, "tickets": int(t1 or 0)},
            "sideB": {"name": f2, "tickets": int(t2 or 0)},
            "note": "Авто из логов TR2" if is_tr2 else "Авто из логов TR1",
            "source": "tr2-logs-auto" if is_tr2 else "tr1-logs-auto",
            "teamA": team_a,
            "teamB": team_b,
        }
        PLAYERS.mkdir(parents=True, exist_ok=True)
        (PLAYERS / f"{mid}.json").write_text(
            json.dumps(players_doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        row = {
            "id": mid,
            "day": msk.day,
            "timeMsk": msk.strftime("%H:%M"),
            "map": layer,
            "mode": players_doc["mode"],
            "size": "—",
            "server": players_doc["server"],
            "duration": duration,
            "factionA": f1,
            "ticketsA": int(t1 or 0),
            "factionB": f2,
            "ticketsB": int(t2 or 0),
            "winner": winner,
            "status": "done",
            "playersUrl": f"data/training/players/{mid}.json",
            "source": "tr1-logs-auto",
        }
        upsert_month({"id": mid, "month": month, "row": row})

        # Pin away from rotating SquadGame.log — copy window into stable file name.
        log_name = log_path.name
        if log_name == "SquadGame.log":
            stable = CACHE / f"SquadGame-{msk.strftime('%Y.%m.%d')}-{mid}.log"
            if not stable.is_file() or stable.stat().st_size < log_path.stat().st_size:
                stable.write_bytes(log_path.read_bytes())
            log_name = stable.name

        auto.append(
            {
                "id": mid,
                "map": layer,
                "date": msk.strftime("%Y-%m-%d"),
                "log": log_name,
                "start": start_iso,
                "end": end.isoformat(),
            }
        )
        known_ids.add(mid)
        known_starts.add(start_iso)
        anchors.append((msk.day, stem, start))
        added += 1
        print(f"+ train {mid} {layer} {duration}", flush=True)

    AUTO_MATCHES.write_text(
        json.dumps(auto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"done added={added} auto_matches={len(auto)}", flush=True)

    def _ledger_missing_auto() -> list[str]:
        ladder = TRAIN / "rp-ladder.json"
        if not ladder.is_file():
            return [
                str(m.get("id"))
                for m in auto
                if m.get("id")
                and not m.get("skip")
                and not str(m.get("id")).endswith("-skip")
            ]
        try:
            ids = {
                str(x.get("id"))
                for x in (json.loads(ladder.read_text(encoding="utf-8")).get("matches") or [])
                if x.get("id")
            }
        except Exception:
            return ["(unreadable-ladder)"]
        missing = []
        for m in auto:
            mid = str(m.get("id") or "")
            if not mid or m.get("skip") or mid.endswith("-skip"):
                continue
            if mid not in ids:
                missing.append(mid)
        return missing

    need_rp = _ledger_missing_auto()
    if added or need_rp:
        if need_rp and not added:
            print(f"RP lag detected — rebuild for {need_rp}", flush=True)
        # 1) Publish match JSON first so /tm updates without waiting for RP rebuild.
        bump_cache_bust()
        publish_live_mirrors()
        # 2) Heavy RP rebuild — low CPU priority so Next/Postgres stay responsive.
        import shutil
        import subprocess

        rebuild = [sys.executable, str(HERE / "build_train_rp_ledger.py")]
        if shutil.which("nice"):
            rebuild = ["nice", "-n", "15", *rebuild]
        if shutil.which("ionice"):
            rebuild = ["ionice", "-c3", *rebuild]
        env = {**os.environ, "BB_KV_PUBLIC": str(KV_PUBLIC)}
        print("train RP rebuild (low priority)…", flush=True)
        subprocess.run(rebuild, cwd=str(HERE), check=False, env=env)
        still = _ledger_missing_auto()
        if still:
            print(f"WARN: RP still missing after rebuild: {still}", flush=True)
        bump_cache_bust()
        publish_live_mirrors()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

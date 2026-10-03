#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Хвост SquadGame.log → POST join/leave + BBHitZone hits на bb-squad.ru.

Env (не коммитить секреты):
  SQUAD_SSH_HOST=194.93.2.107
  SQUAD_SSH_PORT=2022
  SQUAD_SSH_USER=squad
  SQUAD_SSH_PASSWORD=...
  # Один лог (legacy):
  SQUAD_LOG_PATH=/home/squad/servers/TPUB1/SquadGame/Saved/Logs/SquadGame.log
  SQUAD_SERVER_KEY=TPUB1
  # Или несколько серверов (тренировка TR1+TR2 + паб):
  SQUAD_SERVERS=TR1,TR2,TPUB1
  SQUAD_LOG_ROOT=/home/squad/servers
  SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
  SQUAD_HITS_INGEST_URL=https://bb-squad.ru/api/ingest/squad-hits
  SQUAD_MATCHES_INGEST_URL=https://bb-squad.ru/api/ingest/public-matches
  SQUAD_INGEST_SECRET=...
  SQUAD_STATE_PATH=./squad_collector_state.json
  SQUAD_POLL_SEC=5

Зависимости: pip install -r requirements-squad-collector.txt
  (paramiko, requests, psycopg2-binary — нужен для авто-RP с PublicMatch)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import paramiko
import requests

# Join/leave со всех SQUAD_SERVERS; hits — только тренировочные (BBHitZone).
# DeployRole / киты — TR1/TR2 + паблик PB1.
TRAINING_HIT_ROLE_SERVERS = frozenset({"TR1", "TR2"})
# История матчей паблика — только PB1/TPUB1 (SEED отфильтровываем).
PUBLIC_MATCH_SERVERS = frozenset({"TPUB1", "PB1", "PUB"})
ROLE_SERVERS = TRAINING_HIT_ROLE_SERVERS | PUBLIC_MATCH_SERVERS

# Name may contain spaces; passworded servers append ?PASSWORD=… before userId.
LOGIN_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*LogNet: Login request: \?Name=(?P<name>[^?]+)"
    r"(?:\?[^\s]*)?"
    r"\s+userId: RedpointEOS:(?P<eos>[0-9a-fA-F]{32})",
)
REMOVE_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*RemovePlayer\(UserId:\s*(?P<eos>[0-9a-fA-F]{32})\)",
)
# Steam64 = 17 digits (7656 + 13). Shorter capture truncated IDs and broke ingest.
STEAM_EOS_RE = re.compile(
    r"EOS:\s*(?P<eos>[0-9a-fA-F]{32}).*?steam:\s*(?P<steam>7656\d{13})"
    r"|steam:\s*(?P<steam2>7656\d{13}).*?EOS:\s*(?P<eos2>[0-9a-fA-F]{32})",
    re.IGNORECASE,
)
# Line timestamp for BBHitZone (and anything else).
LINE_TS_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
)
# Live mod uses Key=<val>; spec also allows Key=val without brackets.
HIT_RE = re.compile(
    r"BBHitZone:\s*"
    r"AttackerEOS=<?(?P<aeos>[0-9a-fA-F]{32}|none)>?\s+"
    r"(?:AttackerSteam=<?(?P<asteam>7656\d{13}|none)>?\s+)?"
    r"VictimEOS=<?(?P<veos>[0-9a-fA-F]{32}|none)>?\s+"
    r"Zone=<?(?P<zone>[^>\s]+)>?\s+"
    r"Damage=<?(?P<damage>[^>\s]+)>?\s+"
    r"Bone=<?(?P<bone>[^>\s]+)>?"
    r"(?:\s+Weapon=<?(?P<weapon>[^>\s]+)>?)?"
    r"(?:\s+Server=<?(?P<server>[^>\s]+)>?)?",
    re.IGNORECASE,
)
# DeployRole spawn (standard kits only — CQB filtered in kit_from_role)
DEPLOY_RE = re.compile(
    r"PC=(?P<nick>.+?)(?:\s+\(Online IDs:[^)]*\))?\s+"
    r"(?:Spawn=\S+\s+)?"
    r".*?DeployRole=(?P<role>\S+)",
    re.IGNORECASE,
)
# End of match (won/lost pair) — LogSquadGameEvents
MATCH_RESULT_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\].*"
    r"LogSquadGameEvents:\s*Display:\s*Team\s+(?P<team>[12]),\s+"
    r"(?P<faction>.+?)\s+\(\s*(?P<side>.+?)\s*\)\s+has\s+"
    r"(?P<outcome>won|lost)\s+the\s+match\s+with\s+(?P<tickets>\d+)\s+Tickets\s+"
    r"on\s+layer\s+(?P<layer>.+?)\s+\(level\s+(?P<level>.+?)\)!",
    re.IGNORECASE,
)

# Mirror of platform/src/lib/squadKits.ts — keep in sync.
_KIT_RULES: list[tuple[re.Pattern[str], str | None]] = [
    (re.compile(r"^CQB(_|$)", re.I), None),
    (re.compile(r"Pilot", re.I), "Пилот"),
    (
        re.compile(
            r"Crewman.*(^|_)SL(_|$)|Crewman.*Lead|Vehicle.*(Lead|Commander)|LeadCrewman|CrewLead",
            re.I,
        ),
        "Командир Мехводов",
    ),
    (re.compile(r"Crewman|CrewMan", re.I), "Мехвод"),
    (re.compile(r"Medic|Corpsman", re.I), "Медик"),
    (re.compile(r"HeavyMachine|HMG", re.I), "Тяжелый Пулемет"),
    (
        re.compile(r"Autorifleman|LightMachine|LMG|MachineGun|Machinegunner", re.I),
        "Легкий Пулемет",
    ),
    (re.compile(r"Sapper|CombatEngineer|Engineer|Pioneer", re.I), "Сапер/Инженер"),
    (re.compile(r"Grenadier", re.I), "Гранатомет подствольный"),
    (re.compile(r"HAT|HeavyAntiTank|Tandem", re.I), "Тандем"),
    (re.compile(r"LAT|LightAntiTank", re.I), "Легкая Труба"),
    (re.compile(r"Sniper", re.I), "Снайпер"),
    (re.compile(r"Marksman|Sharpshooter", re.I), "Марксман"),
    (re.compile(r"Scout|Recon", re.I), "Разведчик"),
    (re.compile(r"Raider", re.I), "Рейдер"),
    (
        re.compile(r"(^|_)SL(_|$)|SquadLead|SquadLeader|Officer|Commander", re.I),
        "Командир отряда",
    ),
    (re.compile(r"Rifleman|Recruit", re.I), "Стрелок"),
]


def kit_from_role(role: str) -> str | None:
    role = (role or "").strip()
    if not role:
        return None
    for rx, name in _KIT_RULES:
        if rx.search(role):
            return name
    return None


def _safe_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args)
        print(text.encode("ascii", "backslashreplace").decode("ascii"), **kwargs)


def load_dotenv_file(path: Path, *, override: bool = False) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if not key:
            continue
        if override or key not in os.environ:
            os.environ[key] = val


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or v == "":
        raise SystemExit(f"missing env {name}")
    return v


def parse_ts(ts: str) -> str:
    # 2026.09.20-13.51.23 → assume UTC (Squad dedicated logs)
    dt = datetime.strptime(ts, "%Y.%m.%d-%H.%M.%S").replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def clean_nick(raw: str) -> str:
    nick = (raw or "").strip()
    if "?" in nick:
        nick = nick.split("?", 1)[0]
    return nick.strip()


def resolve_log_targets() -> list[tuple[str, str]]:
    """Return list of (serverKey, logPath)."""
    servers = os.environ.get("SQUAD_SERVERS", "").strip()
    root = os.environ.get("SQUAD_LOG_ROOT", "/home/squad/servers").rstrip("/")
    if servers:
        out: list[tuple[str, str]] = []
        for key in servers.split(","):
            key = key.strip()
            if not key:
                continue
            path = f"{root}/{key}/SquadGame/Saved/Logs/SquadGame.log"
            out.append((key, path))
        if out:
            return out
    path = os.environ.get(
        "SQUAD_LOG_PATH",
        f"{root}/TPUB1/SquadGame/Saved/Logs/SquadGame.log",
    )
    key = os.environ.get("SQUAD_SERVER_KEY", "TPUB1")
    return [(key, path)]


class Collector:
    def __init__(self) -> None:
        self.host = env("SQUAD_SSH_HOST")
        self.port = int(os.environ.get("SQUAD_SSH_PORT", "2022"))
        self.user = env("SQUAD_SSH_USER")
        self.password = env("SQUAD_SSH_PASSWORD")
        self.targets = resolve_log_targets()
        self.ingest_url = env("SQUAD_INGEST_URL")
        hits_default = self.ingest_url.replace(
            "/api/ingest/squad-sessions", "/api/ingest/squad-hits"
        )
        if hits_default == self.ingest_url:
            hits_default = "https://bb-squad.ru/api/ingest/squad-hits"
        self.hits_ingest_url = os.environ.get(
            "SQUAD_HITS_INGEST_URL", hits_default
        ).strip() or hits_default
        roles_default = self.ingest_url.replace(
            "/api/ingest/squad-sessions", "/api/ingest/squad-roles"
        )
        if roles_default == self.ingest_url:
            roles_default = "https://bb-squad.ru/api/ingest/squad-roles"
        self.roles_ingest_url = os.environ.get(
            "SQUAD_ROLES_INGEST_URL", roles_default
        ).strip() or roles_default
        matches_default = self.ingest_url.replace(
            "/api/ingest/squad-sessions", "/api/ingest/public-matches"
        )
        if matches_default == self.ingest_url:
            matches_default = "https://bb-squad.ru/api/ingest/public-matches"
        self.matches_ingest_url = os.environ.get(
            "SQUAD_MATCHES_INGEST_URL", matches_default
        ).strip() or matches_default
        backfill_default = self.ingest_url.replace(
            "/api/ingest/squad-sessions", "/api/ingest/backfill-sessions"
        )
        if backfill_default == self.ingest_url:
            backfill_default = "https://bb-squad.ru/api/ingest/backfill-sessions"
        self.backfill_jobs_url = os.environ.get(
            "SQUAD_BACKFILL_JOBS_URL", backfill_default
        ).strip() or backfill_default
        self.ingest_secret = env("SQUAD_INGEST_SECRET")
        self._public_rp_pending = False
        self._public_rp_last = 0.0
        self._public_rp_debounce = int(
            os.environ.get("PUBLIC_RP_DEBOUNCE_SEC") or "180"
        )
        self.state_path = Path(
            os.environ.get("SQUAD_STATE_PATH", "squad_collector_state.json")
        )
        self.poll_sec = float(os.environ.get("SQUAD_POLL_SEC", "3"))
        self.eos_steam: dict[str, str] = {}
        # eos -> {nick, at, serverKey}
        self.pending_joins: dict[str, dict[str, Any]] = {}
        # leave до появления steam-карты
        self.pending_leaves: dict[str, dict[str, Any]] = {}
        # serverKey|ts|layer -> partial match (won/lost pair)
        self._match_buf: dict[str, dict[str, Any]] = {}
        # serverKey -> {offset, inode}
        self.log_state: dict[str, dict[str, Any]] = {
            key: {"offset": 0, "inode": None} for key, _ in self.targets
        }
        # Какие backup уже дочитали (имя файла)
        self.processed_backups: set[str] = set()
        self._pending_backup_catchup: set[str] = set()
        self._load_state()
        # При старте один раз проверим свежие backup (после простоя / отпуска)
        for key, _ in self.targets:
            self._pending_backup_catchup.add(key)

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            raw_map = {
                str(k).lower(): str(v) for k, v in (data.get("eos_steam") or {}).items()
            }
            self.eos_steam = {
                k: v for k, v in raw_map.items() if re.fullmatch(r"7656\d{13}", v)
            }
            self.pending_joins = data.get("pending_joins") or {}
            self.pending_leaves = data.get("pending_leaves") or {}
            raw_backs = data.get("processed_backups") or []
            if isinstance(raw_backs, list):
                self.processed_backups = {str(x) for x in raw_backs}
            logs = data.get("logs")
            if isinstance(logs, dict):
                for key, meta in logs.items():
                    if key in self.log_state and isinstance(meta, dict):
                        self.log_state[key] = {
                            "offset": int(meta.get("offset", 0)),
                            "inode": meta.get("inode"),
                        }
            elif len(self.targets) == 1:
                # legacy single-log state
                key = self.targets[0][0]
                self.log_state[key] = {
                    "offset": int(data.get("offset", 0)),
                    "inode": data.get("inode"),
                }
            if len(self.eos_steam) != len(raw_map):
                _safe_print(
                    f"state: dropped {len(raw_map) - len(self.eos_steam)} truncated steam ids",
                    file=sys.stderr,
                )
        except Exception as e:
            _safe_print("state load fail", e, file=sys.stderr)

    def _valid_steam(self, steam: str) -> str | None:
        steam = (steam or "").strip()
        return steam if re.fullmatch(r"7656\d{13}", steam) else None

    def _save_state(self) -> None:
        payload = {
            "logs": self.log_state,
            "eos_steam": self.eos_steam,
            "pending_joins": self.pending_joins,
            "pending_leaves": self.pending_leaves,
            "processed_backups": sorted(self.processed_backups)[-80:],
        }
        # keep legacy fields for the first target (compat)
        if self.targets:
            key = self.targets[0][0]
            payload["offset"] = self.log_state[key]["offset"]
            payload["inode"] = self.log_state[key]["inode"]
        self.state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _ssh(self) -> paramiko.SSHClient:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(
            self.host,
            port=self.port,
            username=self.user,
            password=self.password,
            timeout=45,
            banner_timeout=90,
            allow_agent=False,
            look_for_keys=False,
        )
        return c

    def _stat(self, client: paramiko.SSHClient, log_path: str) -> tuple[int, str]:
        cmd = f'stat -c "%s %i" {log_path}'
        _, out, _ = client.exec_command(cmd, timeout=30)
        text = out.read().decode("utf-8", "replace").strip()
        size_s, ino_s = text.split()
        return int(size_s), ino_s

    def _read_chunk(
        self, client: paramiko.SSHClient, log_path: str, start: int, size: int
    ) -> bytes:
        length = max(0, size - start)
        if length == 0:
            return b""
        length = min(length, 8 * 1024 * 1024)
        cmd = (
            f"dd if={log_path} bs=1 skip={start} count={length} "
            f"2>/dev/null"
        )
        _, out, _ = client.exec_command(cmd, timeout=120)
        return out.read()

    def _post(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        sessions = [e for e in events if e.get("type") in ("join", "leave")]
        hits = [e for e in events if e.get("type") == "hit"]
        roles = [e for e in events if e.get("type") == "role"]
        matches = [e for e in events if e.get("type") == "match"]
        headers = {
            "Authorization": f"Bearer {self.ingest_secret}",
            "Content-Type": "application/json",
        }
        if sessions:
            r = requests.post(
                self.ingest_url,
                headers=headers,
                json={"events": sessions},
                timeout=30,
            )
            if r.status_code >= 300:
                _safe_print(
                    "ingest sessions fail",
                    r.status_code,
                    r.text[:300],
                    file=sys.stderr,
                )
            else:
                _safe_print("ingest sessions", r.json())
        if hits:
            # Chunk large hit bursts (training can spam)
            chunk = 500
            for i in range(0, len(hits), chunk):
                part = hits[i : i + chunk]
                r = requests.post(
                    self.hits_ingest_url,
                    headers=headers,
                    json={"events": part},
                    timeout=60,
                )
                if r.status_code >= 300:
                    _safe_print(
                        "ingest hits fail",
                        r.status_code,
                        r.text[:300],
                        file=sys.stderr,
                    )
                else:
                    _safe_print("ingest hits", r.json())
        if roles:
            chunk = 500
            for i in range(0, len(roles), chunk):
                part = roles[i : i + chunk]
                r = requests.post(
                    self.roles_ingest_url,
                    headers=headers,
                    json={"events": part},
                    timeout=60,
                )
                if r.status_code >= 300:
                    _safe_print(
                        "ingest roles fail",
                        r.status_code,
                        r.text[:300],
                        file=sys.stderr,
                    )
                else:
                    _safe_print("ingest roles", r.json())
        if matches:
            chunk = 100
            ok_any = False
            for i in range(0, len(matches), chunk):
                part = matches[i : i + chunk]
                r = requests.post(
                    self.matches_ingest_url,
                    headers=headers,
                    json={"events": part},
                    timeout=60,
                )
                if r.status_code >= 300:
                    _safe_print(
                        "ingest matches fail",
                        r.status_code,
                        r.text[:300],
                        file=sys.stderr,
                    )
                else:
                    ok_any = True
                    _safe_print("ingest matches", r.json())
            if ok_any:
                self._public_rp_pending = True
                # Keep local history cache in sync even if ledger rebuild
                # cannot read Postgres (missing psycopg2 in collector venv).
                try:
                    self._merge_match_history_cache(matches)
                except Exception as e:
                    _safe_print(
                        "match-history cache merge fail",
                        type(e).__name__,
                        e,
                        file=sys.stderr,
                    )

    def _merge_match_history_cache(self, matches: list[dict[str, Any]]) -> None:
        """Append accepted PB1 match events into data/public/match-history.json."""
        cache_path = Path(__file__).resolve().parent.parent / "data" / "public" / "match-history.json"
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        existing: list[dict[str, Any]] = []
        if cache_path.is_file():
            try:
                raw = json.loads(cache_path.read_text(encoding="utf-8"))
                existing = list(
                    (raw.get("matches") if isinstance(raw, dict) else raw) or []
                )
            except Exception:
                existing = []

        def key_of(m: dict[str, Any]) -> str:
            return "|".join(
                [
                    str(m.get("endedAt") or m.get("at") or ""),
                    str(m.get("mapName") or ""),
                    str(m.get("score1") or 0),
                    str(m.get("score2") or 0),
                    str(m.get("serverKey") or "TPUB1"),
                ]
            )

        by_key = {key_of(m): m for m in existing if isinstance(m, dict)}
        added = 0
        for ev in matches:
            if ev.get("type") and ev.get("type") != "match":
                continue
            row = {
                "endedAt": ev.get("at"),
                "mapName": ev.get("mapName") or "",
                "layerName": ev.get("layerName") or "",
                "score1": int(ev.get("score1") or 0),
                "score2": int(ev.get("score2") or 0),
                "winnerTeam": ev.get("winnerTeam"),
                "winnerName": ev.get("winnerName") or "",
                "serverKey": ev.get("serverKey") or "TPUB1",
                "faction1": ev.get("faction1"),
                "faction2": ev.get("faction2"),
            }
            if not row["endedAt"] or not row["mapName"]:
                continue
            k = key_of(row)
            if k not in by_key:
                added += 1
            by_key[k] = row
        merged = sorted(by_key.values(), key=lambda m: str(m.get("endedAt") or ""))
        cache_path.write_text(
            json.dumps(
                {
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "matches": merged,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if added:
            _safe_print(f"match-history cache +{added} → {len(merged)}", flush=True)

    def _parse_hit(
        self, line: str, server_key: str
    ) -> dict[str, Any] | None:
        if "BBHitZone:" not in line:
            return None
        # Hits only from training servers with BBHitZone mod
        if server_key not in TRAINING_HIT_ROLE_SERVERS:
            return None
        hm = HIT_RE.search(line)
        if not hm:
            return None
        tm = LINE_TS_RE.match(line)
        if not tm:
            return None
        aeos_raw = (hm.group("aeos") or "").strip()
        asteam_raw = (hm.group("asteam") or "").strip()
        veos_raw = (hm.group("veos") or "").strip()
        zone = (hm.group("zone") or "").strip()
        damage = (hm.group("damage") or "").strip()
        bone = (hm.group("bone") or "").strip()
        weapon = (hm.group("weapon") or "").strip() or None

        if not bone or bone.lower() == "none":
            return None

        aeos = ""
        if aeos_raw and aeos_raw.lower() != "none":
            aeos = aeos_raw.lower()
        asteam = self._valid_steam(asteam_raw) or ""
        if not asteam and aeos:
            asteam = self.eos_steam.get(aeos, "")
        # Learn map from hit line when both present
        if aeos and asteam:
            self.eos_steam[aeos] = asteam

        veos = ""
        if veos_raw and veos_raw.lower() != "none":
            veos = veos_raw.lower()

        if not aeos and not asteam:
            return None

        return {
            "type": "hit",
            "steamId": asteam or "",
            "eosId": aeos or None,
            "victimEos": veos or None,
            "zone": zone or "Limb",
            "bone": bone,
            "damage": damage or None,
            "weapon": weapon,
            "at": parse_ts(tm.group("ts")),
            "serverKey": server_key,
        }

    def _parse_role(
        self, line: str, server_key: str
    ) -> dict[str, Any] | None:
        if "DeployRole=" not in line:
            return None
        if server_key not in ROLE_SERVERS:
            return None
        dm = DEPLOY_RE.search(line)
        if not dm:
            return None
        tm = LINE_TS_RE.match(line)
        if not tm:
            return None
        role = (dm.group("role") or "").strip().rstrip(",;")
        if not kit_from_role(role):
            return None
        nick = clean_nick(dm.group("nick") or "")
        sm = STEAM_EOS_RE.search(line)
        eos = ""
        steam = ""
        if sm:
            eos = (sm.group("eos") or sm.group("eos2") or "").lower()
            steam = self._valid_steam(sm.group("steam") or sm.group("steam2") or "") or ""
            if eos and steam:
                self.eos_steam[eos] = steam
        if not steam and eos:
            steam = self.eos_steam.get(eos, "")
        if not steam and not eos and not nick:
            return None
        return {
            "type": "role",
            "steamId": steam or "",
            "eosId": eos or None,
            "nick": nick or None,
            "role": role,
            "at": parse_ts(tm.group("ts")),
            "serverKey": server_key,
        }

    def _remember_map(self, eos: str, steam: str) -> list[dict[str, Any]]:
        eos = eos.lower()
        steam_ok = self._valid_steam(steam)
        if not steam_ok:
            return []
        steam = steam_ok
        events: list[dict[str, Any]] = []
        self.eos_steam[eos] = steam
        if eos in self.pending_joins:
            pj = self.pending_joins.pop(eos)
            events.append(
                {
                    "type": "join",
                    "steamId": steam,
                    "eosId": eos,
                    "nick": pj.get("nick"),
                    "at": pj["at"],
                    "serverKey": pj.get("serverKey") or self.targets[0][0],
                }
            )
        if eos in self.pending_leaves:
            pl = self.pending_leaves.pop(eos)
            events.append(
                {
                    "type": "leave",
                    "steamId": steam,
                    "eosId": eos,
                    "at": pl["at"],
                    "serverKey": pl.get("serverKey") or self.targets[0][0],
                }
            )
        return events

    def _emit_leave(
        self, eos: str, at: str, server_key: str
    ) -> list[dict[str, Any]]:
        self.pending_joins.pop(eos, None)
        # дедуп UnregisterPlayer + RemovePlayer в одну секунду
        prev = self.pending_leaves.get(eos)
        if prev and prev.get("at") == at and prev.get("serverKey") == server_key:
            return []
        steam = self.eos_steam.get(eos)
        if steam:
            self.pending_leaves.pop(eos, None)
            return [
                {
                    "type": "leave",
                    "steamId": steam,
                    "eosId": eos,
                    "at": at,
                    "serverKey": server_key,
                }
            ]
        self.pending_leaves[eos] = {"at": at, "serverKey": server_key}
        _safe_print(
            f"leave without steam map → eos-only {eos[:8]}… @ {server_key}",
            flush=True,
        )
        return [
            {
                "type": "leave",
                "steamId": "",
                "eosId": eos,
                "at": at,
                "serverKey": server_key,
            }
        ]

    def _parse_match(
        self, line: str, server_key: str
    ) -> dict[str, Any] | None:
        if "has won the match" not in line and "has lost the match" not in line:
            return None
        if server_key not in PUBLIC_MATCH_SERVERS:
            return None
        mm = MATCH_RESULT_RE.search(line)
        if not mm:
            return None
        layer = (mm.group("layer") or "").strip()
        level = (mm.group("level") or "").strip()
        if re.search(r"\bseed\b", layer, re.I) or re.search(r"\bseed\b", level, re.I):
            return None
        team = int(mm.group("team"))
        faction = (mm.group("faction") or "").strip()
        side = (mm.group("side") or "").strip()
        outcome = (mm.group("outcome") or "").lower()
        tickets = int(mm.group("tickets"))
        ts = mm.group("ts")
        at = parse_ts(ts)
        buf_key = f"{server_key}|{ts}|{layer}"
        buf = self._match_buf.get(buf_key)
        if not buf:
            buf = {
                "at": at,
                "serverKey": server_key,
                "mapName": level,
                "layerName": layer,
                "teams": {},
                "winnerTeam": None,
                "winnerName": None,
            }
            self._match_buf[buf_key] = buf
        buf["teams"][team] = {
            "faction": faction,
            "side": side,
            "score": tickets,
        }
        if outcome == "won":
            buf["winnerTeam"] = team
            buf["winnerName"] = faction
        if 1 in buf["teams"] and 2 in buf["teams"] and buf.get("winnerTeam"):
            self._match_buf.pop(buf_key, None)
            t1 = buf["teams"][1]
            t2 = buf["teams"][2]
            return {
                "type": "match",
                "at": buf["at"],
                "serverKey": server_key,
                "mapName": buf["mapName"],
                "layerName": buf["layerName"],
                "faction1": t1["faction"],
                "faction1Side": t1["side"],
                "score1": t1["score"],
                "faction2": t2["faction"],
                "faction2Side": t2["side"],
                "score2": t2["score"],
                "winnerTeam": buf["winnerTeam"],
                "winnerName": buf["winnerName"],
            }
        # Drop stale incomplete buffers (keep last ~40)
        if len(self._match_buf) > 40:
            for old_key in list(self._match_buf.keys())[:10]:
                self._match_buf.pop(old_key, None)
        return None

    def _keech_tracker(self):
        if getattr(self, "_keech_hunt", None) is None:
            try:
                from keech_hunt_tracker import KeechHuntTracker

                self._keech_hunt = KeechHuntTracker()
            except Exception as e:
                _safe_print("keech hunt init fail", type(e).__name__, e, file=sys.stderr)
                self._keech_hunt = False  # type: ignore
        return self._keech_hunt if self._keech_hunt is not False else None

    def _handle_line(self, line: str, server_key: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        kt = self._keech_tracker()
        if kt is not None:
            try:
                kt.feed(line, server_key)
            except Exception as e:
                _safe_print("keech hunt feed", type(e).__name__, e, file=sys.stderr)
        hit = self._parse_hit(line, server_key)
        if hit:
            events.append(hit)
        role = self._parse_role(line, server_key)
        if role:
            events.append(role)
        match_ev = self._parse_match(line, server_key)
        if match_ev:
            events.append(match_ev)

        m = STEAM_EOS_RE.search(line)
        if m:
            eos = (m.group("eos") or m.group("eos2") or "").lower()
            steam = m.group("steam") or m.group("steam2") or ""
            if eos and steam:
                events.extend(self._remember_map(eos, steam))

        lm = LOGIN_RE.search(line)
        if lm:
            eos = lm.group("eos").lower()
            nick = clean_nick(lm.group("name"))
            at = parse_ts(lm.group("ts"))
            steam = self.eos_steam.get(eos)
            if steam:
                events.append(
                    {
                        "type": "join",
                        "steamId": steam,
                        "eosId": eos,
                        "nick": nick,
                        "at": at,
                        "serverKey": server_key,
                    }
                )
            else:
                self.pending_joins[eos] = {
                    "nick": nick,
                    "at": at,
                    "serverKey": server_key,
                }
            return events

        rm = REMOVE_RE.search(line)
        if rm:
            eos = rm.group("eos").lower()
            at = parse_ts(rm.group("ts"))
            events.extend(self._emit_leave(eos, at, server_key))
        return events

    def _poll_one(
        self, client: paramiko.SSHClient, server_key: str, log_path: str
    ) -> list[dict[str, Any]]:
        st = self.log_state[server_key]
        size, inode = self._stat(client, log_path)
        if st.get("inode") and inode != st["inode"]:
            _safe_print(f"log rotated {server_key}, queue offset + catchup backup")
            # Дочитать свежий backup, иначе leave за вечер теряются
            self._pending_backup_catchup.add(server_key)
            st["offset"] = 0
        st["inode"] = inode
        if size < int(st["offset"]):
            st["offset"] = 0
            self._pending_backup_catchup.add(server_key)

        offset = int(st["offset"])
        if (
            offset == 0
            and size > 256 * 1024
            and os.environ.get("SQUAD_BACKFILL") != "1"
            and not self.eos_steam
            and not self.pending_joins
        ):
            _safe_print(f"bootstrap {server_key}: seek end size={size}")
            st["offset"] = size
            return []

        raw = self._read_chunk(client, log_path, offset, size)
        if not raw:
            return []
        text = raw.decode("utf-8", "replace")
        if not text.endswith("\n"):
            cut = text.rfind("\n")
            if cut < 0:
                return []
            consumed = len(raw[: cut + 1])
            text = text[: cut + 1]
        else:
            consumed = len(raw)

        batch: list[dict[str, Any]] = []
        for line in text.splitlines():
            batch.extend(self._handle_line(line, server_key))
        st["offset"] = offset + consumed
        return batch

    def _catchup_backups(
        self, client: paramiko.SSHClient, server_key: str, log_path: str
    ) -> list[dict[str, Any]]:
        """Дочитать свежие SquadGame-backup-*.log (после ротации / простоя)."""
        if server_key not in self._pending_backup_catchup:
            return []
        self._pending_backup_catchup.discard(server_key)
        log_dir = log_path.rsplit("/", 1)[0]
        # последние ~4 backup + не помеченные processed
        cmd = (
            f"ls -1t {log_dir}/SquadGame-backup-*.log 2>/dev/null | head -6 || true"
        )
        try:
            _, out, _ = client.exec_command(cmd, timeout=30)
            files = [
                f.strip()
                for f in out.read().decode("utf-8", "replace").splitlines()
                if f.strip()
            ]
        except Exception as e:
            _safe_print(f"backup list {server_key}", type(e).__name__, e, file=sys.stderr)
            return []

        batch: list[dict[str, Any]] = []
        for path in files:
            name = path.rsplit("/", 1)[-1]
            if name in self.processed_backups:
                continue
            # Login / Remove / steam↔EOS / BBHitZone — не весь 20MB
            grep_cmd = (
                f"grep -E 'Login request:|RemovePlayer\\(UserId:|"
                f"EOS:.*steam:|steam:.*EOS:|BBHitZone:|DeployRole=|"
                f"has won the match|has lost the match' "
                f"{path} 2>/dev/null || true"
            )
            try:
                _, gout, _ = client.exec_command(grep_cmd, timeout=180)
                text = gout.read().decode("utf-8", "replace")
            except Exception as e:
                _safe_print(
                    f"backup read {name}", type(e).__name__, e, file=sys.stderr
                )
                continue
            n = 0
            for line in text.splitlines():
                ev = self._handle_line(line, server_key)
                if ev:
                    batch.extend(ev)
                    n += 1
            self.processed_backups.add(name)
            _safe_print(f"backup catchup {server_key} {name} events≈{n}", flush=True)
        return batch

    def poll_once(self) -> None:
        last_err: Exception | None = None
        client = None
        for attempt in range(1, 4):
            try:
                client = self._ssh()
                last_err = None
                break
            except Exception as e:
                last_err = e
                _safe_print(f"ssh connect retry {attempt}/3", type(e).__name__, e, file=sys.stderr)
                time.sleep(min(5 * attempt, 15))
        if client is None:
            _safe_print("poll error", type(last_err).__name__, last_err, file=sys.stderr)
            # всё равно трогаем state mtime, чтобы watchdog не бесился
            try:
                self._save_state()
            except Exception:
                pass
            return
        try:
            batch: list[dict[str, Any]] = []
            for server_key, log_path in self.targets:
                try:
                    batch.extend(self._catchup_backups(client, server_key, log_path))
                    batch.extend(self._poll_one(client, server_key, log_path))
                except Exception as e:
                    _safe_print(
                        f"poll {server_key} error",
                        type(e).__name__,
                        e,
                        file=sys.stderr,
                    )
            self._post(batch)
            self.maybe_rebuild_public_rp()
            kt = self._keech_tracker()
            if kt is not None:
                try:
                    kt.flush()
                except Exception as e:
                    _safe_print("keech hunt flush", type(e).__name__, e, file=sys.stderr)
            self._save_state()
        finally:
            try:
                client.close()
            except Exception:
                pass

    def maybe_rebuild_public_rp(self, *, force: bool = False) -> None:
        """Rebuild PB1 combat/RP ledger from TPUB1 logs (debounced)."""
        if not force and not self._public_rp_pending:
            return
        now = time.time()
        if not force and (now - self._public_rp_last) < self._public_rp_debounce:
            return
        script = Path(__file__).resolve().parent / "build_public_rp_ledger.py"
        if not script.is_file():
            return
        self._public_rp_pending = False
        self._public_rp_last = now
        _safe_print("public RP rebuild start (background)", flush=True)
        try:
            log_path = Path(__file__).resolve().parent / "_tmp_public_rp_rebuild.log"
            log_f = open(log_path, "a", encoding="utf-8")
            subprocess.Popen(
                [sys.executable, str(script)],
                cwd=str(script.parent),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            # log_f stays open for child; OK for long-running collector
        except Exception as e:
            _safe_print(
                "public RP rebuild error",
                type(e).__name__,
                e,
                file=sys.stderr,
            )

    def process_backfill_jobs(self) -> None:
        """После регистрации: дозалить join/leave из логов за прошлые дни."""
        headers = {
            "Authorization": f"Bearer {self.ingest_secret}",
            "Content-Type": "application/json",
        }
        try:
            r = requests.get(
                self.backfill_jobs_url,
                headers=headers,
                params={"limit": "2"},
                timeout=30,
            )
        except Exception as e:
            _safe_print("backfill jobs fetch fail", type(e).__name__, e, file=sys.stderr)
            return
        if r.status_code >= 300:
            # endpoint ещё не задеплоен — тихо
            if r.status_code != 404:
                _safe_print("backfill jobs HTTP", r.status_code, r.text[:200], file=sys.stderr)
            return
        jobs = (r.json() or {}).get("jobs") or []
        if not jobs:
            return
        script = Path(__file__).resolve().parent / "backfill_player_sessions.py"
        for job in jobs:
            jid = job.get("id")
            steam = str(job.get("steamId") or "").strip()
            nick = str(job.get("nick") or "").strip()
            _safe_print("backfill job start", jid, steam, nick)
            ok = False
            err = None
            try:
                cmd = [sys.executable, str(script), "--steam", steam]
                if nick:
                    cmd += ["--nick", nick]
                proc = subprocess.run(
                    cmd,
                    cwd=str(script.parent),
                    timeout=900,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                if proc.stdout:
                    _safe_print(proc.stdout[-1500:])
                if proc.returncode != 0:
                    err = (proc.stderr or proc.stdout or f"exit {proc.returncode}")[-500:]
                    raise RuntimeError(err)
                ok = True
            except Exception as e:
                err = str(e)[:500]
                _safe_print("backfill job fail", jid, err, file=sys.stderr)
            try:
                requests.post(
                    self.backfill_jobs_url,
                    headers=headers,
                    json={"complete": {"id": jid, "ok": ok, "error": err}},
                    timeout=30,
                )
            except Exception as e:
                _safe_print("backfill complete fail", type(e).__name__, e, file=sys.stderr)

    def _bootstrap_keech_hunt(self) -> None:
        """One-shot: rebuild current Keech match from recent TPUB1 log tail."""
        kt = self._keech_tracker()
        if kt is None:
            return
        target = None
        for key, path in self.targets:
            if key in ("TPUB1", "PB1", "PUB"):
                target = (key, path)
                break
        if not target:
            return
        server_key, log_path = target
        try:
            client = self._ssh()
        except Exception as e:
            _safe_print("keech bootstrap ssh", type(e).__name__, e, file=sys.stderr)
            return
        try:
            cmd = (
                f"python3 - <<'PY'\n"
                f"from pathlib import Path\n"
                f"p=Path({log_path!r})\n"
                f"raw=p.read_bytes()\n"
                f"if len(raw)>12*1024*1024: raw=raw[-12*1024*1024:]\n"
                f"print(raw.decode('utf-8','replace'), end='')\n"
                f"PY"
            )
            _i, out, _e = client.exec_command(cmd, timeout=180)
            text = out.read().decode("utf-8", "replace")
            kt.bootstrap_text(text, server_key)
            _safe_print("keech hunt bootstrap ok", server_key, flush=True)
        except Exception as e:
            _safe_print("keech bootstrap fail", type(e).__name__, e, file=sys.stderr)
        finally:
            try:
                client.close()
            except Exception:
                pass

    def run(self) -> None:
        _safe_print(
            "collector start",
            self.host,
            ", ".join(f"{k}={p}" for k, p in self.targets),
        )
        try:
            self._bootstrap_keech_hunt()
        except Exception as e:
            _safe_print("keech bootstrap", type(e).__name__, e, file=sys.stderr)
        ticks = 0
        # Раз в час снова дочитать свежие backup (пропуск leave в live / рестарт).
        rebackup_every = max(1, int(3600 / max(self.poll_sec, 1)))
        stale_tick_every = max(1, int(60 / max(self.poll_sec, 1)))
        # Очередь дозаливки после регистрации — раз в ~2 мин
        backfill_every = max(1, int(120 / max(self.poll_sec, 1)))
        # Полный rebuild public RP раз в ~15 мин (страховка)
        public_rp_every = max(1, int(900 / max(self.poll_sec, 1)))
        while True:
            try:
                ticks += 1
                if ticks % rebackup_every == 0:
                    for key, _ in self.targets:
                        self._pending_backup_catchup.add(key)
                    # разрешить перечитать 2 самых свежих backup
                    for name in sorted(self.processed_backups, reverse=True)[:2]:
                        self.processed_backups.discard(name)
                    _safe_print("hourly backup re-catchup armed", flush=True)
                self.poll_once()
                if ticks % public_rp_every == 0:
                    self._public_rp_pending = True
                    try:
                        self.maybe_rebuild_public_rp(force=True)
                    except Exception as e:
                        _safe_print(
                            "public RP tick fail",
                            type(e).__name__,
                            e,
                            file=sys.stderr,
                        )
                if ticks % backfill_every == 0:
                    try:
                        self.process_backfill_jobs()
                    except Exception as e:
                        _safe_print(
                            "backfill tick fail",
                            type(e).__name__,
                            e,
                            file=sys.stderr,
                        )
                # Пустой POST → на сайте stale-close висяков >18ч
                if ticks % stale_tick_every == 0:
                    try:
                        requests.post(
                            self.ingest_url,
                            headers={
                                "Authorization": f"Bearer {self.ingest_secret}",
                                "Content-Type": "application/json",
                            },
                            json={"events": []},
                            timeout=20,
                        )
                    except Exception as e:
                        _safe_print(
                            "stale-tick fail",
                            type(e).__name__,
                            e,
                            file=sys.stderr,
                        )
            except Exception as e:
                _safe_print("poll error", type(e).__name__, e, file=sys.stderr)
            time.sleep(self.poll_sec)


if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    load_dotenv_file(here / ".squad-collector.env", override=True)
    Collector().run()

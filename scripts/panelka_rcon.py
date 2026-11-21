#!/usr/bin/env python3
"""RCON TR1–TR5 through the game-host SSH the collector already uses.

Prints JSON to stdout. Passwords stay in Rcon.cfg on the game host.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

import paramiko

KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5", "PB1")
AGENT_PORT = 18765
AGENT_REMOTE = "/home/squad/bb_panelka_agent.py"
AGENT_PID = "/tmp/bb_panelka_agent.pid"
# UI key PB1 → game-host folder TPUB1
HOST_DIR = {"PB1": "TPUB1"}
MODS = {
    "FCL": "3569460354",
    "CSL": "3294562930",
    "SEC": "3661196801",
    # Steam Workshop ModLoader — layer ModLoader_v1 for HitZone / stats init
    # https://steamcommunity.com/sharedfiles/filedetails/?id=3516838562
    "LOADER": "3516838562",
}
FACTIONS = {
    "WPMC": "ЧВК СТАРОЕ",
    "TLF": "Турция",
    "USMC": "Морская Пехота",
    "GFI": "Иран",
    "USA": "Америка",
    "RGF": "Россия",
    "CRF": "Новая канада",
    "VDV": "ВДВ",
    "CAF": "Канада",
    "MEI": "Талибы",
    "BAF": "Англия",
    "IMF": "Сербы",
    "ADF": "Австралия",
    "PLA": "Китай",
}
DECKS = (
    "AirAssault",
    "Armored",
    "LightInfantry",
    "Mechanized",
    "Motorized",
    "Support",
)
SKIP_VANILLA = (
    "JensensLobby",
    "Automation",
    "CoopTemplate",
    "Tutorial",
)


def host_dir(key: str) -> str:
    return HOST_DIR.get(key, key)


REMOTE = r'''
import json, re, socket, struct, sys, base64, os, shutil, subprocess, time
from concurrent.futures import ThreadPoolExecutor
job = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
HOST={"PB1":"TPUB1"}
UI_KEYS=("TR1","TR2","TR3","TR4","TR5","PB1")
_HEALTH_CACHE = {}
_CREATES_CACHE = {}
def host(key):
    return HOST.get(key, key)

def rcon(key, cmd, attempts=4):
    """Source RCON. Pauses chat listener via /tmp/bb_panelka_pause_<key> first."""
    import time as _time
    hk = host(key)
    cfg_path = f"/home/squad/servers/{hk}/SquadGame/ServerConfig/Rcon.cfg"
    text = open(cfg_path, encoding="utf-8", errors="replace").read()
    port = 21114
    pw = ""
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"Port\s*=\s*(\d+)", line, re.I)
        if m:
            port = int(m.group(1))
        m = re.match(r"Password\s*=\s*(.+)", line, re.I)
        if m:
            pw = m.group(1).strip().strip('"').strip("'")
    pause = f"/tmp/bb_panelka_pause_{key}"
    open(pause, "w").write(str(_time.time()))
    last_err = None
    try:
        _time.sleep(0.35)
        for attempt in range(max(1, attempts)):
            s = None
            try:
                s = socket.create_connection(("127.0.0.1", port), timeout=8)
                s.settimeout(8)

                def send(i, t, b):
                    p = struct.pack("<ii", i, t) + b.encode("utf-8") + b"\x00\x00"
                    s.sendall(struct.pack("<i", len(p)) + p)

                def recvall(n):
                    buf = b""
                    while len(buf) < n:
                        chunk = s.recv(n - len(buf))
                        if not chunk:
                            raise RuntimeError("rcon closed")
                        buf += chunk
                    return buf

                def recv():
                    n = struct.unpack("<i", recvall(4))[0]
                    if n < 10 or n > 4_000_000:
                        raise RuntimeError("bad packet")
                    d = recvall(n)
                    i, t = struct.unpack("<ii", d[:8])
                    return i, t, d[8:-2].decode("utf-8", "replace")

                send(1, 3, pw)
                while True:
                    i, t, _b = recv()
                    if t == 2:
                        if i == -1:
                            raise RuntimeError("rcon auth failed")
                        break
                send(2, 2, cmd)
                parts = []
                s.settimeout(2.0)
                try:
                    while True:
                        i, t, b = recv()
                        if i == 2 and t == 0:
                            parts.append(b)
                            s.settimeout(0.15)
                            if len(parts) > 200:
                                break
                        elif i == -1:
                            raise RuntimeError("rcon rejected")
                except (socket.timeout, TimeoutError, RuntimeError):
                    if not parts:
                        raise
                return "".join(parts)
            except Exception as exc:
                last_err = exc
                _time.sleep(0.35 * (attempt + 1))
            finally:
                if s is not None:
                    try:
                        s.close()
                    except Exception:
                        pass
        raise RuntimeError(str(last_err) if last_err else "rcon failed")
    finally:
        try:
            os.remove(pause)
        except Exception:
            pass

def _chat_pids():
    """Real python chat-bot PIDs only (pgrep -f also matches the pgrep/bash line)."""
    real = []
    try:
        for ent in os.listdir("/proc"):
            if not ent.isdigit():
                continue
            try:
                raw = open(f"/proc/{ent}/cmdline", "rb").read()
            except Exception:
                continue
            if not raw:
                continue
            cmd = raw.replace(b"\x00", b" ").decode("utf-8", "replace")
            if "bb_panelka_chat.py" in cmd and "python" in cmd:
                real.append(int(ent))
    except Exception:
        return []
    return real

def ensure_chat_listener():
    """Exactly one chat listener. Never thrash-restart under parallel panel polls.
    If panelka agent is alive, do NOT start legacy chat bot (agent owns RCON+chat)."""
    import fcntl
    try:
        ap = open("/tmp/bb_panelka_agent.pid", encoding="utf-8").read().strip()
        if ap.isdigit() and os.path.isdir("/proc/%s" % ap):
            return
    except Exception:
        pass
    pid_path = "/tmp/bb_panelka_chat.pid"
    lock_path = "/tmp/bb_panelka_chat.lock"
    script = "/home/squad/bb_panelka_chat.py"
    if not os.path.isfile(script):
        return

    def _write_pid(pid):
        open(pid_path, "w", encoding="utf-8").write(str(pid))

    pids = _chat_pids()
    if len(pids) == 1:
        _write_pid(pids[0])
        return
    if len(pids) > 1:
        # Keep oldest, kill extras — do NOT restart (avoids spawn storms).
        keep = min(pids)
        for pid in pids:
            if pid == keep:
                continue
            try:
                os.kill(pid, 9)
            except Exception:
                pass
        _write_pid(keep)
        return

    # count == 0 — start under flock so parallel workers don't each spawn one
    try:
        lock_f = open(lock_path, "w")
    except Exception:
        return
    try:
        try:
            fcntl.flock(lock_f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            time.sleep(0.6)
            pids = _chat_pids()
            if pids:
                _write_pid(min(pids))
            return
        pids = _chat_pids()
        if pids:
            _write_pid(min(pids))
            return
        proc = subprocess.Popen(
            ["python3", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        _write_pid(proc.pid)
        time.sleep(0.2)
    finally:
        try:
            fcntl.flock(lock_f, fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            lock_f.close()
        except Exception:
            pass

def read_chat(key):
    import json, re
    # Do not ensure/restart chat bot on every 5s chat poll — that races with roster.
    spoken = []
    seen = set()
    path = "/home/squad/bb-panelka-chat.jsonl"
    if os.path.isfile(path):
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()[-500:]
        for line in lines:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("key") != key:
                continue
            item = {
                "clock": row.get("clock") or "",
                "date": row.get("date") or "",
                "channel": row.get("channel") or "чат",
                "name": (row.get("name") or "")[:48],
                "steamId": (row.get("steamId") or "")[:32],
                "text": (row.get("text") or "")[:240],
            }
            dedupe = (
                item["date"],
                item["clock"],
                item["channel"],
                item["name"],
                item["text"].lower(),
            )
            if dedupe in seen:
                continue
            seen.add(dedupe)
            spoken.append(item)
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
    casts = []
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 1_000_000))
            blob = handle.read().decode("utf-8", "replace")
        cast_re = re.compile(r"Message broadcasted <(.*)> from RCON")
        clock_re = re.compile(r"\[(\d{4}\.\d{2}\.\d{2})-(\d{2})\.(\d{2})\.(\d{2})")
        for line in blob.splitlines():
            cast = cast_re.search(line)
            if not cast:
                continue
            clock_m = clock_re.search(line)
            clock = ""
            date = ""
            if clock_m:
                hour = (int(clock_m.group(2)) + 3) % 24
                clock = f"{hour:02d}:{clock_m.group(3)}:{clock_m.group(4)}"
                date = clock_m.group(1).replace(".", "-")
            casts.append({
                "clock": clock,
                "date": date,
                "channel": "всем",
                "name": "Админ",
                "text": cast.group(1).strip(),
            })
    except Exception:
        pass
    return (casts[-15:] + spoken[-60:])[-60:]

def _msk_stamp(line):
    import re
    clock_re = re.compile(r"\[(\d{4}\.\d{2}\.\d{2})-(\d{2})\.(\d{2})\.(\d{2})")
    clock_m = clock_re.search(line)
    if not clock_m:
        return "", ""
    hour = (int(clock_m.group(2)) + 3) % 24
    clock = f"{hour:02d}:{clock_m.group(3)}:{clock_m.group(4)}"
    date = clock_m.group(1).replace(".", "-")
    return date, clock

def read_squad_creates(key):
    """Latest squad create events from SquadGame.log for this round."""
    import os, re
    now = time.time()
    cached = _CREATES_CACHE.get(key)
    if cached and now - cached[0] < 10:
        return cached[1]
    rows = []
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
    if not os.path.isfile(log_path):
        return rows
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 4_000_000))
            blob = handle.read().decode("utf-8", "replace")
    except Exception:
        return rows
    create_re = re.compile(
        r"LogSquad:\s*(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\)\s+"
        r"has created Squad\s+(?P<sid>\d+)\s+\(Squad Name:\s*(?P<sname>.*?)\)\s+on\s+(?P<faction>.+)$",
        re.I,
    )
    for line in blob.splitlines():
        m = create_re.search(line)
        if not m:
            continue
        date, clock = _msk_stamp(line)
        rows.append({
            "id": m.group("sid"),
            "name": (m.group("sname") or "").strip()[:64],
            "nick": (m.group("nick") or "").strip()[:48],
            "steamId": m.group("steam"),
            "faction": (m.group("faction") or "").strip()[:80],
            "clock": clock,
            "date": date,
        })
    rows = rows[-400:]
    _CREATES_CACHE[key] = (now, rows)
    return rows

def read_player_card(key, steam_id, name):
    import json, os, re
    want_name = (name or "").strip().lower()
    chat = []
    path = "/home/squad/bb-panelka-chat.jsonl"
    if os.path.isfile(path):
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()[-1200:]
        for line in lines:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("key") != key:
                continue
            row_name = (row.get("name") or "").strip()
            if want_name and want_name not in row_name.lower() and row_name.lower() not in want_name:
                continue
            chat.append({
                "date": row.get("date") or "",
                "clock": row.get("clock") or "",
                "channel": row.get("channel") or "чат",
                "name": row_name[:48],
                "text": (row.get("text") or "")[:240],
            })
    chat = chat[-120:]

    teamkills = []
    blob = ""
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 2_000_000))
            blob = handle.read().decode("utf-8", "replace")
        possess_re = re.compile(
            r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
            r"(?:Pawn=|Possessed\s+)(?P<pawn>BP_[A-Za-z0-9_]+)",
            re.I,
        )
        possess_alt = re.compile(
            r"steam:\s*(?P<steam>7656\d+)\).*?(?P<nick>[^\]]+?)\s+has possessed \((?P<pawn>BP_[^\)]+)\)",
            re.I,
        )
        die_re = re.compile(
            r"Die\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=[-\d.]+\s+from\s+(?P<causer>\S+)\s+"
            r"\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<vsteam>7656\d+)",
            re.I,
        )
        squad_re = re.compile(
            r"LogSquad:\s*(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\)\s+"
            r"has created Squad\s+\d+\s+\(Squad Name:.*?\)\s+on\s+(?P<faction>.+)$",
            re.I,
        )
        pawn_owner = {}
        steam_faction = {}
        steam_nick = {}
        for line in blob.splitlines():
            for rx in (possess_re, possess_alt):
                pm = rx.search(line)
                if pm:
                    pawn = pm.group("pawn").split()[0].rstrip(",;")
                    pawn_owner[pawn] = pm.group("steam")
                    steam_nick[pm.group("steam")] = (pm.group("nick") or "").strip()[:48]
            sm = squad_re.search(line)
            if sm:
                steam_faction[sm.group("steam")] = (sm.group("faction") or "").strip()
                steam_nick[sm.group("steam")] = (sm.group("nick") or "").strip()[:48]
            dm = die_re.search(line)
            if not dm:
                continue
            causer = dm.group("causer")
            killer_steam = pawn_owner.get(causer)
            if not killer_steam:
                base = causer.rsplit("_", 1)[0] if "_" in causer else causer
                for pawn, owner in pawn_owner.items():
                    if pawn.startswith(base) or causer.startswith(pawn.rsplit("_", 1)[0]):
                        killer_steam = owner
                        break
            if killer_steam != steam_id:
                continue
            victim_steam = dm.group("vsteam")
            if victim_steam == steam_id:
                continue
            kf = steam_faction.get(killer_steam)
            vf = steam_faction.get(victim_steam)
            if kf and vf and kf != vf:
                continue
            date, clock = _msk_stamp(line)
            victim_name = (dm.group("victim") or "").strip()[:48]
            teamkills.append({
                "date": date,
                "clock": clock,
                "victim": victim_name or steam_nick.get(victim_steam) or victim_steam,
                "victimSteamId": victim_steam,
            })
        teamkills = teamkills[-80:]
    except Exception:
        teamkills = []

    punishments = [
        row for row in read_punishments(key, steam_id, name, blob)
        if not _is_tk_auto_msg(row.get("reason") or "")
    ]
    # В чат карточки — системные строки «кто кого наказал», чтобы модеру было видно рядом с репликами
    kind_ru = {"kick": "кик", "ban": "бан", "warn": "админ-сообщение", "report": "репорт"}
    whom = (name or "").strip() or steam_id
    for row in punishments:
        kind = str(row.get("kind") or "")
        if kind not in ("kick", "ban", "warn"):
            continue
        label = kind_ru.get(kind, kind)
        reason = (row.get("reason") or "").strip()
        # убрать префикс [ник] из причины — ник уже в by
        reason = re.sub(r"^\[[^\]]{1,32}\]\s*", "", reason).strip() or reason
        dur = (row.get("duration") or "").strip()
        text = f"{label} → {whom}"
        if reason:
            text = f"{text}: {reason}"
        if dur:
            text = f"{text} · срок {dur}"
        chat.append({
            "date": row.get("date") or "",
            "clock": row.get("clock") or "",
            "channel": "наказание",
            "name": (row.get("by") or "панель")[:48],
            "text": text[:240],
        })
    chat = sorted(chat, key=lambda r: (r.get("date") or "", r.get("clock") or ""))[-120:]
    return {"ok": True, "chat": chat, "teamkills": teamkills, "punishments": punishments}

def _is_tk_auto_msg(reason):
    low = (reason or "").lower()
    return (
        "убил свой" in low
        or "teamkill" in low
        or "team kill" in low
        or "тимкил" in low
    )

def _nick_key(raw):
    text = (raw or "").strip().lower()
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"[〔〕【】]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def _name_hit(want, candidate):
    a = _nick_key(want)
    b = _nick_key(candidate)
    if not a or not b:
        return False
    return a in b or b in a

def append_action_log(row):
    path = "/home/squad/bb-panelka-actions.jsonl"
    try:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        if os.path.getsize(path) > 2_000_000:
            kept = open(path, encoding="utf-8", errors="replace").read().splitlines()[-800:]
            open(path, "w", encoding="utf-8").write("\n".join(kept) + ("\n" if kept else ""))
    except Exception:
        pass

def read_staff_actions_log(limit=400):
    """Все действия админов/модов с панели серверов (кик/бан/варн/команда/отряд)."""
    path = "/home/squad/bb-panelka-actions.jsonl"
    rows = []
    if not os.path.isfile(path):
        return {"ok": True, "entries": []}
    for line in open(path, encoding="utf-8", errors="replace").read().splitlines()[-2500:]:
        try:
            row = json.loads(line)
        except Exception:
            continue
        kind = str(row.get("kind") or "")
        if kind not in ("kick", "ban", "warn", "team", "unsquad", "report", "disband", "rename"):
            continue
        reason = (row.get("reason") or "").strip()
        reason = re.sub(r"^\[[^\]]{1,32}\]\s*", "", reason).strip() or reason
        rows.append({
            "id": f"{row.get('date')}-{row.get('clock')}-{row.get('steamId')}-{kind}-{len(rows)}",
            "kind": kind,
            "date": row.get("date") or "",
            "clock": row.get("clock") or "",
            "key": row.get("key") or "",
            "steamId": str(row.get("steamId") or ""),
            "name": (row.get("name") or "")[:48],
            "reason": reason[:200],
            "duration": row.get("duration") or "",
            "byNick": (row.get("byNick") or row.get("by") or "панель")[:48],
            "bySteamId": str(row.get("bySteamId") or ""),
        })
    rows.reverse()
    return {"ok": True, "entries": rows[: max(20, min(800, int(limit) or 400))]}

def read_punishments(key, steam_id, name, log_blob=""):
    rows = []
    # 1) panelka own log — has who punished
    act_path = "/home/squad/bb-panelka-actions.jsonl"
    if os.path.isfile(act_path):
        for line in open(act_path, encoding="utf-8", errors="replace").read().splitlines()[-1500:]:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("key") != key:
                continue
            if str(row.get("steamId") or "") != steam_id and not _name_hit(name, row.get("name") or ""):
                continue
            kind = str(row.get("kind") or "")
            if kind not in ("kick", "ban", "warn", "report", "team", "unsquad"):
                continue
            reason = (row.get("reason") or "").strip()
            if kind in ("kick", "ban") and not reason:
                reason = "причина не указана"
            rows.append({
                "kind": kind,
                "date": row.get("date") or "",
                "clock": row.get("clock") or "",
                "reason": reason[:200],
                "duration": row.get("duration") or "",
                "by": (row.get("byNick") or row.get("by") or "панель")[:48],
                "source": "panelka",
            })

    # 2) player reports from chat (!r / !report) mentioning this nick
    chat_path = "/home/squad/bb-panelka-chat.jsonl"
    if os.path.isfile(chat_path):
        for line in open(chat_path, encoding="utf-8", errors="replace").read().splitlines()[-2000:]:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("key") != key:
                continue
            text = (row.get("text") or "").strip()
            low = text.lower()
            if not (low.startswith("!r ") or low.startswith("!report ")):
                continue
            body = text.split(" ", 1)[1] if " " in text else ""
            if not _name_hit(name, body) and not _name_hit(name, text):
                continue
            rows.append({
                "kind": "report",
                "date": row.get("date") or "",
                "clock": row.get("clock") or "",
                "reason": body[:200] or text[:200],
                "duration": "",
                "by": (row.get("name") or "игрок")[:48],
                "source": "chat",
            })

    # 3) SquadGame.log kicks / warns / bans for this steam or nick
    if not log_blob:
        log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
        try:
            with open(log_path, "rb") as handle:
                handle.seek(0, 2)
                handle.seek(max(0, handle.tell() - 5_000_000))
                log_blob = handle.read().decode("utf-8", "replace")
        except Exception:
            log_blob = ""
    kick_re = re.compile(
        r"Kicking player:\s*(?P<nick>.+?)\s*;\s*Reason\s*=\s*Kicked from the server:\s*(?P<reason>.*)$",
        re.I,
    )
    kick_id_re = re.compile(
        r"Kicked player\s+\d+\.\s*\[Online IDs=.*?steam:\s*(?P<steam>7656\d+)\].*?(?P<nick>.+?)\s+from RCON",
        re.I,
    )
    warn_re = re.compile(
        r"Remote admin has warned player\s+(?P<nick>.+?)\.\s*Message was\s+\"(?P<reason>.*)\"\s+from RCON",
        re.I,
    )
    ban_re = re.compile(
        r"(?:has banned|Banned player|ADMIN COMMAND:.*[Bb]an).*?(?:steam:\s*(?P<steam>7656\d+))?.*?(?P<nick>.+?)(?:\s+from RCON|$)",
        re.I,
    )
    lines = log_blob.splitlines()
    for i, line in enumerate(lines):
        date, clock = _msk_stamp(line)
        km = kick_re.search(line)
        if km:
            nick = km.group("nick").strip()
            steam = ""
            if i + 1 < len(lines):
                im = kick_id_re.search(lines[i + 1])
                if im:
                    steam = im.group("steam")
                    nick = im.group("nick").strip() or nick
            if steam == steam_id or _name_hit(name, nick):
                reason = (km.group("reason") or "").strip()[:200]
                by = "бот/RCON"
                m_by = re.search(r"\[([^\]]{2,32})\]", reason)
                if m_by and m_by.group(1).upper() not in ("БАН", "АДМИН", "КИК", "BAN", "ADMIN", "KICK"):
                    by = m_by.group(1)[:48]
                elif "[АДМИН]" in reason or "[ADMIN]" in reason.upper():
                    by = "админ (сайт/бот)"
                rows.append({
                    "kind": "ban" if ("[БАН]" in reason or "[BAN]" in reason.upper() or "Banned" in reason) else "kick",
                    "date": date,
                    "clock": clock,
                    "reason": reason,
                    "duration": "",
                    "by": by,
                    "source": "log",
                })
            continue
        wm = warn_re.search(line)
        if wm and _name_hit(name, wm.group("nick")):
            reason = (wm.group("reason") or "").strip()[:200]
            # авто-варны про тимкил — не в историю наказаний (они во вкладке Тимкилы)
            if _is_tk_auto_msg(reason):
                continue
            by = "бот/RCON"
            m_by = re.search(r"^\[([^\]]{2,32})\]\s*", reason)
            if m_by:
                by = m_by.group(1)[:48]
                reason = reason[m_by.end():].strip() or reason
            rows.append({
                "kind": "warn",
                "date": date,
                "clock": clock,
                "reason": reason,
                "duration": "",
                "by": by,
                "source": "log",
            })
            continue
        if "Banned" in line or "has banned" in line.lower():
            bm = ban_re.search(line)
            if not bm:
                continue
            steam = bm.groupdict().get("steam") or ""
            nick = (bm.groupdict().get("nick") or "").strip()
            if steam == steam_id or _name_hit(name, nick):
                rows.append({
                    "kind": "ban",
                    "date": date,
                    "clock": clock,
                    "reason": line.strip()[-180:],
                    "duration": "",
                    "by": "бот/RCON",
                    "source": "log",
                })

    # de-dupe roughly by kind+clock+reason
    seen = set()
    out = []
    for row in sorted(rows, key=lambda r: (r.get("date") or "", r.get("clock") or "")):
        mark = (row.get("kind"), row.get("date"), row.get("clock"), (row.get("reason") or "")[:40])
        if mark in seen:
            continue
        seen.add(mark)
        out.append(row)
    return out[-120:]

def server_row(key):
    info = rcon(key, "ShowServerInfo")
    current = rcon(key, "ShowCurrentMap")
    return {"key": key, "info": info, "current": current}

def read_staff_map():
    path = "/home/squad/admins/Admins.cfg"
    out = {}
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return out
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("//") or not line.startswith("Admin="):
            continue
        m = re.match(r"Admin=(7656\d+)\s*:\s*(\w+)", line, re.I)
        if not m:
            continue
        group = m.group(2)
        if group in ("Admin", "Cameraman"):
            out[m.group(1)] = "admin"
        elif group in ("Moderator", "Intern"):
            out[m.group(1)] = "moderator"
    return out

def live_health_map(key, steam_ids):
    want = set(steam_ids or [])
    states = {sid: "alive" for sid in want}
    if not want:
        return states
    now = time.time()
    cached = _HEALTH_CACHE.get(key)
    if cached and now - cached[0] < 8:
        base = cached[1]
        return {sid: base.get(sid, "alive") for sid in want}
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 1_800_000))
            blob = handle.read().decode("utf-8", "replace")
    except Exception:
        return states
    wound_re = re.compile(
        r"Wound\(\):\s*Player:(?P<nick>.+?)\s+KillingDamage=.*?steam:\s*(?P<steam>7656\d+)",
        re.I,
    )
    die_re = re.compile(
        r"Die\(\):\s*Player:(?P<nick>.+?)\s+KillingDamage=.*?steam:\s*(?P<steam>7656\d+)",
        re.I,
    )
    revive_re = re.compile(
        r"has revived\s+(?P<patient>.+?)\.",
        re.I,
    )
    possess_re = re.compile(
        r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\)",
        re.I,
    )
    # nick -> steam for revive matching
    nick_steam = {}
    for line in blob.splitlines():
        wm = wound_re.search(line)
        if wm:
            steam = wm.group("steam")
            nick_steam[_nick_key(wm.group("nick"))] = steam
            if steam in want:
                states[steam] = "nok"
            continue
        dm = die_re.search(line)
        if dm:
            steam = dm.group("steam")
            nick_steam[_nick_key(dm.group("nick"))] = steam
            if steam in want:
                states[steam] = "dead"
            continue
        if "has revived" in line:
            rm = revive_re.search(line)
            if rm:
                patient = _nick_key(rm.group("patient"))
                steam = nick_steam.get(patient)
                if steam and steam in want:
                    states[steam] = "alive"
            continue
        pm = possess_re.search(line)
        if pm:
            steam = pm.group("steam")
            nick_steam[_nick_key(pm.group("nick"))] = steam
            if steam in want:
                states[steam] = "alive"
    _HEALTH_CACHE[key] = (now, dict(states))
    return states

def mods_root(key):
    return f"/home/squad/servers/{host(key)}/SquadGame/Plugins/Mods"

def mods_config_path(key):
    return f"/home/squad/servers/{host(key)}/SquadGame/ServerConfig/ModsConfig.cfg"

def read_mod_order(key):
    path = mods_config_path(key)
    if not os.path.isfile(path):
        return []
    text = open(path, encoding="utf-8", errors="replace").read()
    for line in text.splitlines():
        if line.strip().startswith("ModLoadOrder="):
            raw = line.split("=", 1)[1].strip()
            return [x.strip() for x in raw.split(",") if x.strip().isdigit()]
    return []

def write_mod_order(key, ids):
    path = mods_config_path(key)
    text = open(path, encoding="utf-8", errors="replace").read() if os.path.isfile(path) else ""
    line = "ModLoadOrder=" + ",".join(ids)
    if re.search(r"^ModLoadOrder=.*$", text, re.M):
        text = re.sub(r"^ModLoadOrder=.*$", line, text, count=1, flags=re.M)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    open(path, "w", encoding="utf-8").write(text)

def list_mods(key):
    root = mods_root(key)
    rows = []
    if not os.path.isdir(root):
        return {"ok": True, "mods": rows, "order": []}
    order = read_mod_order(key)
    for name in sorted(os.listdir(root)):
        if name == "CanadianArmedForces" or not name.isdigit():
            continue
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        local_ts = int(os.path.getmtime(path))
        title = name
        local_updated = local_ts
        try:
            info = json.loads(open(os.path.join(path, "info.json"), encoding="utf-8").read())
            if isinstance(info, dict):
                title = str(info.get("title") or info.get("name") or title)
                if info.get("time_updated"):
                    local_updated = int(info["time_updated"])
        except Exception:
            pass
        for fname in os.listdir(path):
            if fname.endswith(".mi"):
                try:
                    mi = open(os.path.join(path, fname), encoding="utf-8", errors="replace").read()
                    m = re.search(r"^Name=(.+)$", mi, re.M)
                    if m:
                        title = m.group(1).strip() or title
                except Exception:
                    pass
                break
        rows.append({
            "id": name,
            "title": title[:80],
            "localUpdated": local_updated,
            "dirMtime": local_ts,
            "inLoadOrder": name in order,
        })
    return {"ok": True, "mods": rows, "order": order}

def fix_linux_paks(mod_path):
    plugin_paths = []
    if os.path.isdir(os.path.join(mod_path, "Content", "Paks")):
        plugin_paths = [mod_path]
    else:
        for name in os.listdir(mod_path):
            p = os.path.join(mod_path, name)
            if os.path.isdir(p):
                plugin_paths.append(p)
    for plugin in plugin_paths:
        linux = os.path.join(plugin, "Content", "Paks", "LinuxServer")
        win = os.path.join(plugin, "Content", "Paks", "WindowsNoEditor")
        need = True
        if os.path.isdir(linux):
            size = 0
            for fn in os.listdir(linux):
                fp = os.path.join(linux, fn)
                if os.path.isfile(fp):
                    size += os.path.getsize(fp)
            need = size == 0
        if need and os.path.isdir(win):
            if os.path.isdir(linux):
                shutil.rmtree(linux, ignore_errors=True)
            os.rename(win, linux)

def install_mod(key, mod_id, meta):
    hk = host(key)
    server_path = f"/home/squad/servers/{hk}"
    steamcmd = f"/home/squad/steamcmd/{hk}/steamcmd.sh"
    if not os.path.isfile(steamcmd):
        steamcmd = "/home/squad/servers/steamcmd.sh"
    workshop = f"{server_path}/steamapps/workshop/content/393380/{mod_id}"
    target = f"{server_path}/SquadGame/Plugins/Mods/{mod_id}"
    args = [
        steamcmd,
        "+@ShutdownOnFailedCommand", "1",
        "+@NoPromptForPassword", "1",
        "+force_install_dir", server_path,
        "+login", "anonymous",
        "+workshop_download_item", "393380", str(mod_id),
        "+quit",
    ]
    ok = False
    raw = []
    for _try in range(8):
        proc = subprocess.run(args, capture_output=True, text=True, timeout=300)
        msg = ((proc.stdout or "") + "\n" + (proc.stderr or ""))[-200000:]
        raw = msg.splitlines()[-40:]
        if re.search(r"Success\. Downloaded item", msg):
            ok = True
            break
        if not re.search(r"Timeout downloading|work complete queue not empty", msg, re.I):
            break
        time.sleep(2)
    if not ok:
        return {"ok": False, "error": "SteamCMD не скачал мод", "raw": raw[-12:]}
    if os.path.isdir(target):
        shutil.rmtree(target, ignore_errors=True)
    if not os.path.isdir(workshop):
        return {"ok": False, "error": "скачалось, но папки мода нет", "raw": raw[-8:]}
    shutil.move(workshop, target)
    fix_linux_paks(target)
    info = meta if isinstance(meta, dict) else {}
    info.setdefault("publishedfileid", str(mod_id))
    open(os.path.join(target, "info.json"), "w", encoding="utf-8").write(json.dumps(info, ensure_ascii=False, indent=2))
    order = read_mod_order(key)
    if mod_id not in order:
        order.append(mod_id)
        write_mod_order(key, order)
    return {"ok": True, "reply": f"мод {mod_id} установлен — нужен рестарт сервера", "modId": mod_id}

def remove_mod(key, mod_id):
    target = f"{mods_root(key)}/{mod_id}"
    if os.path.isdir(target):
        shutil.rmtree(target, ignore_errors=True)
    order = [x for x in read_mod_order(key) if x != mod_id]
    write_mod_order(key, order)
    return {"ok": True, "reply": f"мод {mod_id} удалён — нужен рестарт сервера", "modId": mod_id}

op = job.get("op")
try:
    if op == "status":
        keys = list(job["keys"])
        def one(key):
            try:
                return server_row(key)
            except Exception as e:
                return {"key": key, "error": str(e)}
        with ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(one, keys))
        print(json.dumps({"ok": True, "rows": rows}, ensure_ascii=False))
    elif op == "players":
        print(json.dumps({"ok": True, "text": rcon(job["key"], "ListPlayers")}, ensure_ascii=False))
    elif op == "roster":
        key = job["key"]
        ensure_chat_listener()
        players_text = rcon(key, "ListPlayers")
        squads_text = rcon(key, "ListSquads")
        steams = re.findall(r"steam:\s*(7656\d{13})", players_text, re.I)
        try:
            creates = read_squad_creates(key)
        except Exception:
            creates = []
        print(json.dumps({
            "ok": True,
            "players": players_text,
            "squads": squads_text,
            "staff": read_staff_map(),
            "health": live_health_map(key, steams),
            "squadCreates": creates,
        }, ensure_ascii=False))
    elif op == "layers":
        print(json.dumps({"ok": True, "text": rcon("TR1", "ListLayers")}, ensure_ascii=False))
    elif op == "cmd":
        text = rcon(job["key"], job["command"])
        if job.get("actionLog") and isinstance(job.get("actionLog"), dict):
            append_action_log(job["actionLog"])
        print(json.dumps({"ok": True, "text": text}, ensure_ascii=False))
    elif op == "chat":
        key = job["key"]
        if key not in UI_KEYS:
            print(json.dumps({"ok": False, "error": "нет такого сервера"}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": True, "messages": read_chat(key)}, ensure_ascii=False))
    elif op == "player-card":
        key = job["key"]
        if key not in UI_KEYS:
            print(json.dumps({"ok": False, "error": "нет такого сервера"}, ensure_ascii=False))
        else:
            print(json.dumps(read_player_card(key, job.get("steamId") or "", job.get("name") or ""), ensure_ascii=False))
    elif op == "staff-log":
        lim = job.get("limit") or 400
        print(json.dumps(read_staff_actions_log(lim), ensure_ascii=False))
    elif op == "mods":
        key = job["key"]
        if key not in UI_KEYS:
            print(json.dumps({"ok": False, "error": "нет такого сервера"}, ensure_ascii=False))
        else:
            print(json.dumps(list_mods(key), ensure_ascii=False))
    elif op == "mod-install":
        key = job["key"]
        mid = str(job.get("modId") or "")
        if key not in UI_KEYS or not re.fullmatch(r"\d{5,12}", mid):
            print(json.dumps({"ok": False, "error": "плохой мод или сервер"}, ensure_ascii=False))
        else:
            print(json.dumps(install_mod(key, mid, job.get("meta") or {}), ensure_ascii=False))
    elif op == "mod-remove":
        key = job["key"]
        mid = str(job.get("modId") or "")
        if key not in UI_KEYS or not re.fullmatch(r"\d{5,12}", mid):
            print(json.dumps({"ok": False, "error": "плохой мод или сервер"}, ensure_ascii=False))
        else:
            print(json.dumps(remove_mod(key, mid), ensure_ascii=False))
    else:
        print(json.dumps({"ok": False, "error": "неизвестная команда"}, ensure_ascii=False))
except Exception:
    print(json.dumps({"ok": False, "error": "сервер оборвал ответ, нажми ещё раз"}, ensure_ascii=False))
'''


def load_env() -> None:
    if os.environ.get("SQUAD_SSH_PASSWORD") and os.environ.get("SQUAD_SSH_HOST"):
        return
    env_path = Path(__file__).resolve().parent / ".squad-collector.env"
    if not env_path.is_file():
        raise SystemExit("no collector env")
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip("'").strip('"'))


_CHAT_SYNCED = False


def sync_chat_listener(force: bool = False) -> None:
    """Upload bb_panelka_chat.py to game host and restart if version changed."""
    global _CHAT_SYNCED
    if _CHAT_SYNCED and not force:
        return
    local = Path(__file__).resolve().parent / "bb_panelka_chat.py"
    if not local.is_file():
        return
    load_env()
    host = os.environ["SQUAD_SSH_HOST"]
    port = int(os.environ.get("SQUAD_SSH_PORT") or 2022)
    user = os.environ.get("SQUAD_SSH_USER") or "squad"
    password = os.environ["SQUAD_SSH_PASSWORD"]
    remote = "/home/squad/bb_panelka_chat.py"
    pid_path = "/tmp/bb_panelka_chat.pid"
    body = local.read_text(encoding="utf-8")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host,
            port=port,
            username=user,
            password=password,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
        sftp = client.open_sftp()
        try:
            with sftp.open(remote, "r") as handle:
                remote_body = handle.read().decode("utf-8", "replace")
        except OSError:
            remote_body = ""
        need_restart = remote_body != body
        if need_restart:
            with sftp.open(remote, "w") as handle:
                handle.write(body.encode("utf-8"))
            try:
                sftp.chmod(remote, 0o664)
            except OSError:
                pass
        # Unique start/reap via /proc cmdline (pgrep -f matches itself).
        restart_flag = "1" if (need_restart or force) else "0"
        cmd = f"""python3 - <<'PY'
import fcntl, os, time, subprocess
remote = {remote!r}
pid_path = {pid_path!r}
lock_path = "/tmp/bb_panelka_chat.lock"
restart = {restart_flag!r} == "1"

def chat_pids():
    out = []
    for ent in os.listdir("/proc"):
        if not ent.isdigit():
            continue
        try:
            raw = open(f"/proc/{{ent}}/cmdline", "rb").read()
        except Exception:
            continue
        if not raw:
            continue
        cmd = raw.replace(b"\\x00", b" ").decode("utf-8", "replace")
        if "bb_panelka_chat.py" in cmd and "python" in cmd:
            out.append(int(ent))
    return out

lock_f = open(lock_path, "w")
fcntl.flock(lock_f, fcntl.LOCK_EX)
try:
    pids = chat_pids()
    if restart or not pids:
        for pid in pids:
            try:
                os.kill(pid, 9)
            except Exception:
                pass
        time.sleep(0.5)
        for pid in chat_pids():
            try:
                os.kill(pid, 9)
            except Exception:
                pass
        time.sleep(0.3)
        proc = subprocess.Popen(
            ["python3", remote],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        open(pid_path, "w", encoding="utf-8").write(str(proc.pid))
        time.sleep(0.25)
        # reap anything else that raced in
        for pid in chat_pids():
            if pid != proc.pid:
                try:
                    os.kill(pid, 9)
                except Exception:
                    pass
        print("started", proc.pid)
    else:
        keep = min(pids)
        for pid in pids:
            if pid != keep:
                try:
                    os.kill(pid, 9)
                except Exception:
                    pass
        open(pid_path, "w", encoding="utf-8").write(str(keep))
        print("keep", keep, "killed_extras", max(0, len(pids) - 1))
    print("final", chat_pids())
finally:
    fcntl.flock(lock_f, fcntl.LOCK_UN)
    lock_f.close()
PY"""
        _stdin, stdout, _stderr = client.exec_command(cmd, timeout=25)
        print("chat-sync", stdout.read().decode("utf-8", "replace").strip())
        err = _stderr.read().decode("utf-8", "replace").strip()
        if err:
            print("chat-sync-err", err[:400])
        sftp.close()
        _CHAT_SYNCED = True
    finally:
        try:
            client.close()
        except Exception:
            pass


_REMOTE_DIGEST = hashlib.sha1(REMOTE.encode("utf-8")).hexdigest()
_AGENT_DIGEST = ""
_ssh_lock = threading.Lock()
_ssh_client: paramiko.SSHClient | None = None
_ssh_last = 0.0
_roster_inflight: dict[str, threading.Event] = {}
_roster_inflight_lock = threading.Lock()
_roster_inflight_result: dict[str, dict] = {}
_AGENT_SYNCED = False


def _ssh_connect() -> paramiko.SSHClient:
    """Stage C: reuse one SSH session (keepalive) instead of connect-per-call."""
    global _ssh_client, _ssh_last
    load_env()
    host = os.environ["SQUAD_SSH_HOST"]
    port = int(os.environ.get("SQUAD_SSH_PORT") or 2022)
    user = os.environ.get("SQUAD_SSH_USER") or "squad"
    password = os.environ["SQUAD_SSH_PASSWORD"]
    with _ssh_lock:
        transport = _ssh_client.get_transport() if _ssh_client else None
        if _ssh_client and transport and transport.is_active() and time.time() - _ssh_last < 90:
            _ssh_last = time.time()
            return _ssh_client
        if _ssh_client:
            try:
                _ssh_client.close()
            except Exception:
                pass
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            host,
            port=port,
            username=user,
            password=password,
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
        transport = client.get_transport()
        if transport:
            transport.set_keepalive(20)
        _ssh_client = client
        _ssh_last = time.time()
        return client


def _ssh_exec(command: str, timeout: int = 40) -> tuple[str, str]:
    client = _ssh_connect()
    try:
        _, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace").strip()
        err = stderr.read().decode("utf-8", "replace").strip()
        with _ssh_lock:
            global _ssh_last
            _ssh_last = time.time()
        return out, err
    except Exception:
        with _ssh_lock:
            global _ssh_client
            try:
                if _ssh_client:
                    _ssh_client.close()
            except Exception:
                pass
            _ssh_client = None
        raise


def sync_panelka_agent(force: bool = False) -> None:
    """Upload/start game-host agent (owns RCON + chat). Safe: never touches Squad binary."""
    global _AGENT_SYNCED, _AGENT_DIGEST
    if _AGENT_SYNCED and not force:
        return
    local = Path(__file__).resolve().parent / "bb_panelka_agent.py"
    if not local.is_file():
        return
    body = local.read_text(encoding="utf-8")
    digest = hashlib.sha1(body.encode("utf-8")).hexdigest()
    client = _ssh_connect()
    sftp = client.open_sftp()
    code_changed = False
    try:
        remote_body = ""
        try:
            with sftp.open(AGENT_REMOTE, "r") as handle:
                remote_body = handle.read().decode("utf-8", "replace")
        except OSError:
            remote_body = ""
        code_changed = remote_body != body
        if code_changed or force:
            with sftp.open(AGENT_REMOTE, "w") as handle:
                handle.write(body.encode("utf-8"))
            try:
                sftp.chmod(AGENT_REMOTE, 0o755)
            except OSError:
                pass
    finally:
        sftp.close()
    # Start unique agent; stop legacy chat bots inside agent boot.
    # Restart when code changed so new agent binary is actually running.
    force_py = "True" if (force or code_changed) else "False"
    cmd = f"""python3 - <<'PY'
import fcntl, os, time, subprocess
remote = {AGENT_REMOTE!r}
pid_path = {AGENT_PID!r}
lock_path = "/tmp/bb_panelka_agent.lock"
force = {force_py}

def agent_pids():
    out = []
    for ent in os.listdir("/proc"):
        if not ent.isdigit():
            continue
        try:
            raw = open(f"/proc/{{ent}}/cmdline", "rb").read()
        except Exception:
            continue
        cmd = raw.replace(b"\\x00", b" ").decode("utf-8", "replace")
        if "bb_panelka_agent.py" in cmd and "python" in cmd:
            out.append(int(ent))
    return out

lock_f = open(lock_path, "w")
fcntl.flock(lock_f, fcntl.LOCK_EX)
try:
    pids = agent_pids()
    need = force or not pids
    if need:
        for pid in pids:
            try: os.kill(pid, 9)
            except Exception: pass
        time.sleep(0.45)
        for pid in agent_pids():
            try: os.kill(pid, 9)
            except Exception: pass
        time.sleep(0.25)
        proc = subprocess.Popen(
            ["python3", remote],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        open(pid_path, "w").write(str(proc.pid))
        time.sleep(0.8)
        # wipe legacy chat again after boot (agent also does this, belt+suspenders)
        for ent in os.listdir("/proc"):
            if not ent.isdigit():
                continue
            try:
                raw = open(f"/proc/{{ent}}/cmdline", "rb").read()
            except Exception:
                continue
            cmdl = raw.replace(b"\\x00", b" ").decode("utf-8", "replace")
            if "bb_panelka_chat.py" in cmdl and "python" in cmdl:
                try: os.kill(int(ent), 9)
                except Exception: pass
        print("started", proc.pid, "final", agent_pids())
    else:
        keep = min(pids)
        for pid in pids:
            if pid != keep:
                try: os.kill(pid, 9)
                except Exception: pass
        open(pid_path, "w").write(str(keep))
        # never revive chat while agent alive
        for ent in os.listdir("/proc"):
            if not ent.isdigit():
                continue
            try:
                raw = open(f"/proc/{{ent}}/cmdline", "rb").read()
            except Exception:
                continue
            cmdl = raw.replace(b"\\x00", b" ").decode("utf-8", "replace")
            if "bb_panelka_chat.py" in cmdl and "python" in cmdl:
                try: os.kill(int(ent), 9)
                except Exception: pass
        print("keep", keep, "final", agent_pids())
finally:
    fcntl.flock(lock_f, fcntl.LOCK_UN)
    lock_f.close()
# health
import urllib.request
try:
    print("health", urllib.request.urlopen("http://127.0.0.1:{AGENT_PORT}/health", timeout=3).read().decode())
except Exception as e:
    print("health-fail", e)
PY"""
    out, err = _ssh_exec(cmd, timeout=30)
    print("agent-sync", out)
    if err:
        print("agent-sync-err", err[:300])
    _AGENT_DIGEST = digest
    _AGENT_SYNCED = True


def agent_request(
    method: str,
    path: str,
    payload: dict | None = None,
    timeout: int = 25,
) -> dict:
    """Call local agent over SSH (curl to 127.0.0.1). Falls back raises."""
    sync_panelka_agent(force=False)
    if method.upper() == "GET":
        cmd = (
            f"curl -sS --max-time {max(3, timeout - 2)} "
            f"'http://127.0.0.1:{AGENT_PORT}{path}'"
        )
    else:
        body = json.dumps(payload or {}, ensure_ascii=False)
        # base64 to avoid shell quoting issues
        b64 = base64.b64encode(body.encode("utf-8")).decode("ascii")
        cmd = (
            f"echo {b64} | base64 -d | curl -sS --max-time {max(3, timeout - 2)} "
            f"-H 'Content-Type: application/json' "
            f"--data-binary @- 'http://127.0.0.1:{AGENT_PORT}{path}'"
        )
    out, err = _ssh_exec(cmd, timeout=timeout)
    if not out:
        raise RuntimeError(err or "agent empty")
    return json.loads(out)


def ssh_job(job: dict, timeout: int = 40) -> dict:
    payload = base64.b64encode(json.dumps(job).encode("utf-8")).decode("ascii")
    client = _ssh_connect()
    sftp = client.open_sftp()
    try:
        marker = "/tmp/bb_panelka_rcon.sha1"
        need_write = True
        try:
            with sftp.open(marker, "r") as handle:
                need_write = handle.read().decode("ascii", "replace").strip() != _REMOTE_DIGEST
        except OSError:
            need_write = True
        if need_write:
            with sftp.file("/tmp/bb_panelka_rcon.py", "w") as handle:
                handle.write(REMOTE)
            with sftp.file(marker, "w") as handle:
                handle.write(_REMOTE_DIGEST)
    finally:
        sftp.close()
    out, err = _ssh_exec(f"python3 /tmp/bb_panelka_rcon.py {payload}", timeout=timeout)
    if not out:
        raise RuntimeError(err or "empty rcon reply")
    return json.loads(out)


def pretty_map(current: str, info: dict) -> tuple[str, str]:
    match = re.search(r"Current level is (.+?), layer is (\S+)", current or "")
    if match:
        return match.group(1).strip(), match.group(2).strip().rstrip(",")
    layer = str(info.get("MapName_s") or "—")
    return layer.replace("_", " "), layer


def parse_info(raw: str) -> dict:
    start = raw.find("{")
    if start < 0:
        return {}
    try:
        obj, _ = json.JSONDecoder().raw_decode(raw[start:])
    except json.JSONDecodeError:
        return {}
    return obj if isinstance(obj, dict) else {}


STATUS_CACHE = Path("/tmp/bb-panelka-status-v3.json")


def _info_int(info: dict, *keys: str) -> int:
    for key in keys:
        raw = info.get(key)
        if raw is None or raw == "":
            continue
        try:
            return max(0, int(raw))
        except (TypeError, ValueError):
            continue
    return 0


def status() -> dict:
    if STATUS_CACHE.is_file():
        age = time.time() - STATUS_CACHE.stat().st_mtime
        if age < 12:
            try:
                cached = json.loads(STATUS_CACHE.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                cached = None
            if (
                isinstance(cached, dict)
                and cached.get("ok")
                and cached.get("servers")
                and len(cached.get("servers") or []) == len(KEYS)
            ):
                return cached
    data = ssh_job({"op": "status", "keys": list(KEYS)}, timeout=50)
    servers = []
    for row in data.get("rows") or []:
        key = row.get("key")
        if row.get("error"):
            servers.append(
                {
                    "key": key,
                    "name": key,
                    "map": "нет ответа",
                    "layer": "",
                    "players": 0,
                    "maxPlayers": 100,
                    "queue": 0,
                    "error": row["error"],
                }
            )
            continue
        info = parse_info(row.get("info") or "")
        map_name, layer = pretty_map(row.get("current") or "", info)
        players = _info_int(info, "PlayerCount_I", "PlayerCount")
        max_players = _info_int(info, "MaxPlayers") or 100
        queue = _info_int(info, "PublicQueue_I", "PublicQueue") + _info_int(
            info, "ReservedQueue_I", "ReservedQueue"
        )
        label = str(info.get("ServerName_s") or key).strip() or key
        if key == "PB1" and label in ("PB1", "TPUB1", ""):
            label = "PB1 · BlackBerry Public"
        servers.append(
            {
                "key": key,
                "name": label,
                "map": map_name,
                "layer": layer,
                "players": players,
                "maxPlayers": max_players,
                "queue": queue,
                "error": None,
            }
        )
    # Keep UI order even if SSH rows shuffle
    by_key = {row["key"]: row for row in servers if row.get("key")}
    ordered = [by_key[k] for k in KEYS if k in by_key]
    for k in KEYS:
        if k not in by_key:
            ordered.append(
                {
                    "key": k,
                    "name": k,
                    "map": "нет ответа",
                    "layer": "",
                    "players": 0,
                    "maxPlayers": 100,
                    "queue": 0,
                    "error": "нет ответа",
                }
            )
    result = {"ok": True, "servers": ordered}
    if any(not row.get("error") for row in ordered):
        try:
            STATUS_CACHE.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    return result


PLAYER_RE = re.compile(
    r"ID:\s*(?P<id>\d+)\s*\|\s*Online IDs:\s*(?P<ids>.*?)\s*\|\s*Name:\s*(?P<name>.*?)\s*\|\s*Team ID:\s*(?P<team>[^|]+)\|\s*Party ID:\s*[^|]*\|\s*Squad ID:\s*(?P<squad>[^|]+)\|\s*Is Leader:\s*(?P<leader>[^|]+)\|\s*Role:\s*(?P<role>[^|]+?)(?:\s*\|\s*Vehicle:\s*(?P<vehicle>.*?))?\s*$",
    re.I | re.M,
)
SQUAD_TEAM_RE = re.compile(r"Team ID:\s*(\d+)\s*\((.+?)\)\s*-\s*Tickets:\s*(\d+)")
SQUAD_ROW_RE = re.compile(
    r"ID:\s*(\d+)\s*\|\s*Name:\s*(.*?)\s*\|\s*Size:\s*(\d+)\s*\|\s*Locked:\s*(True|False)",
    re.I,
)
ROLE_LABELS = {
    "SL": "СЛ",
    "Medic": "мед",
    "LAT": "ЛАТ",
    "HAT": "ХАТ",
    "Rifleman": "стрелок",
    "AR": "пул",
    "Grenadier": "грена",
    "Marksman": "маркс",
    "Sapper": "сапёр",
    "Raider": "рейд",
    "Crewman": "экипаж",
    "Pilot": "пилот",
    "Recruit": "рекрут",
    "MachineGunner": "пул",
}


def role_label(role: str) -> str:
    parts = [part for part in role.split("_") if part and not part.isdigit()]
    kind = parts[1] if len(parts) > 1 else (parts[0] if parts else "")
    return ROLE_LABELS.get(kind, "")


def short_vehicle(raw: str) -> str:
    text = (raw or "").strip()
    if not text or text.upper() in ("N/A", "NA", "NONE", "-"):
        return ""
    # "ZBD04A (Driver)" → "ZBD04A · вод"
    seat_map = {
        "driver": "вод",
        "passenger": "пас",
        "turret operator": "баш",
        "gunner": "стрел",
        "commander": "кмд",
    }
    seat = ""
    m = re.search(r"\(([^)]+)\)\s*$", text)
    if m:
        seat = seat_map.get(m.group(1).strip().lower(), m.group(1).strip()[:8])
        text = text[: m.start()].strip()
    text = text.replace("BP_", "").replace("_C", "")
    if len(text) > 18:
        text = text[:18]
    return f"{text} · {seat}" if seat else text


def parse_player_rows(text: str) -> list[dict]:
    rows = []
    for match in PLAYER_RE.finditer(text):
        name = match.group("name").strip()
        steam_m = re.search(r"steam:\s*(7656\d{13})", match.group("ids"), re.I)
        if not name or not steam_m:
            continue
        team = match.group("team").strip()
        squad = match.group("squad").strip()
        role = match.group("role").strip()
        vehicle_raw = (match.groupdict().get("vehicle") or "").strip()
        rows.append(
            {
                "id": int(match.group("id")),
                "name": name,
                "steamId": steam_m.group(1),
                "team": team if team in ("1", "2") else "",
                "squad": squad if squad.isdigit() else "",
                "leader": match.group("leader").strip().lower() == "true",
                "role": role_label(role),
                "vehicle": short_vehicle(vehicle_raw),
            }
        )
    rows.sort(key=lambda row: (row["team"] or "9", row["name"].lower()))
    return rows


def players(key: str) -> dict:
    data = ssh_job({"op": "players", "key": key})
    if data.get("ok") is False:
        return data
    return {"ok": True, "players": parse_player_rows(data.get("text") or "")}


def _norm_token(text: str) -> str:
    return re.sub(r"[^a-z0-9а-яё]+", "", (text or "").lower())


def _faction_matches_team(faction: str, team_name: str) -> bool:
    """Log faction is full English; ListSquads may be full or short."""
    fac = _norm_token(faction)
    team = _norm_token(team_name)
    if not fac or not team:
        return False
    if team == fac or team in fac or fac in team:
        return True
    aliases = {
        "westernprivatemilitarycontractors": ("wpmc", "чвк", "чвкстарое"),
        "armedforcesofukraine": ("afu", "ukraine", "украина", "всy", "всу"),
        "unitedstatesmarinecorps": ("usmc", "морскаяпехота"),
        "unitedstatesarmy": ("usa", "америка", "usarmy"),
        "russianairborneforces": ("vdv", "вдв"),
        "russiangroundforces": ("rgf", "россия", "rfa"),
        "britisharmedforces": ("baf", "england", "англия"),
        "canadianarmedforces": ("caf", "канада"),
        "australiandefenceforce": ("adf", "австралия"),
        "peoplesliberationarmy": ("pla", "китай"),
        "middleeasternalliance": ("mei", "талибы", "mea"),
        "irregularmilitiaforces": ("imf", "сербы"),
        "turkishlandforces": ("tlf", "турция"),
        "groundforcesofiran": ("gfi", "иран"),
        "canadianrebelforces": ("crf", "новаяканада"),
    }
    for full, shorts in aliases.items():
        if fac == full or full in fac or fac in full:
            if team in shorts or any(s in team for s in shorts):
                return True
        if team == full or any(team == s or s in team for s in shorts):
            if fac == full or full in fac or fac in full or any(s in fac for s in shorts):
                return True
    return False


def _attach_squad_creates(teams: dict[str, dict], creates: list) -> None:
    """Attach create clock/nick. Name in log stays 'Squad N' after rename — match by team+id."""
    if not creates:
        for team in teams.values():
            for squad in team["squads"]:
                lead = next((p for p in squad["players"] if p.get("leader")), None)
                if lead:
                    squad["creatorName"] = lead["name"]
                    squad["createdClock"] = ""
        return

    # Latest create per (teamId, squadId), preferring stronger signals.
    best_map: dict[tuple[str, str], tuple[int, dict]] = {}
    for row in creates:
        sid = str(row.get("id") or "")
        if not sid:
            continue
        for team in teams.values():
            team_id = str(team.get("id") or "")
            squad = next((s for s in team["squads"] if str(s.get("id")) == sid), None)
            if not squad:
                continue
            steams = {p.get("steamId") for p in squad["players"] if p.get("steamId")}
            nicks = {(p.get("name") or "").strip().lower() for p in squad["players"]}
            steam_ok = str(row.get("steamId") or "") in steams
            nick_ok = (str(row.get("nick") or "").strip().lower() in nicks) if row.get("nick") else False
            faction_ok = _faction_matches_team(str(row.get("faction") or ""), str(team.get("name") or ""))
            if not (faction_ok or steam_ok or nick_ok):
                continue
            score = 1
            if faction_ok:
                score += 2
            if steam_ok:
                score += 3
            if nick_ok:
                score += 2
            name_tok = _norm_token(str(row.get("name") or ""))
            squad_tok = _norm_token(str(squad.get("name") or ""))
            if name_tok and squad_tok and name_tok == squad_tok:
                score += 1
            key = (team_id, sid)
            prev = best_map.get(key)
            # Later log rows win on equal/higher score (creates are chronological).
            if not prev or score >= prev[0]:
                best_map[key] = (score, row)

    for team in teams.values():
        for squad in team["squads"]:
            hit = best_map.get((str(team.get("id") or ""), str(squad.get("id") or "")))
            if hit:
                row = hit[1]
                clock = str(row.get("clock") or "")
                # Prefer HH:MM for the roster header.
                squad["createdClock"] = clock[:5] if len(clock) >= 5 else clock
                squad["creatorName"] = str(row.get("nick") or "")[:48]
                squad["creatorSteamId"] = str(row.get("steamId") or "")[:32]
            else:
                lead = next((p for p in squad["players"] if p.get("leader")), None)
                if lead:
                    squad["creatorName"] = lead["name"]
                    squad["createdClock"] = ""


def _parse_roster_payload(data: dict) -> dict:
    if data.get("ok") is False:
        return data
    teams: dict[str, dict] = {}
    current = ""
    for line in (data.get("squads") or "").splitlines():
        team_m = SQUAD_TEAM_RE.search(line)
        if team_m:
            current = team_m.group(1)
            teams[current] = {
                "id": current,
                "name": team_m.group(2).strip(),
                "tickets": int(team_m.group(3)),
                "squads": [],
                "loose": [],
            }
            continue
        squad_m = SQUAD_ROW_RE.search(line)
        if squad_m and current:
            teams[current]["squads"].append(
                {
                    "id": squad_m.group(1),
                    "name": squad_m.group(2).strip() or f"Squad {squad_m.group(1)}",
                    "size": int(squad_m.group(3)),
                    "locked": squad_m.group(4).lower() == "true",
                    "players": [],
                    "createdClock": "",
                    "creatorName": "",
                }
            )
    staff = data.get("staff") if isinstance(data.get("staff"), dict) else {}
    health = data.get("health") if isinstance(data.get("health"), dict) else {}
    by_squad = {(team["id"], squad["id"]): squad for team in teams.values() for squad in team["squads"]}
    for person in parse_player_rows(data.get("players") or ""):
        team = teams.get(person["team"])
        if not team:
            continue
        squad = by_squad.get((person["team"], person["squad"]))
        bucket = squad["players"] if squad else team["loose"]
        sid = person["steamId"]
        hp = str(health.get(sid) or "alive")
        if hp not in ("alive", "nok", "dead"):
            hp = "alive"
        rights = str(staff.get(sid) or "")
        if rights not in ("admin", "moderator"):
            rights = ""
        bucket.append(
            {
                "id": person["id"],
                "name": person["name"],
                "steamId": sid,
                "leader": person["leader"],
                "role": person["role"],
                "vehicle": person.get("vehicle") or "",
                "health": hp,
                "rights": rights,
            }
        )
    creates = data.get("squadCreates") if isinstance(data.get("squadCreates"), list) else []
    _attach_squad_creates(teams, creates)
    for team in teams.values():
        team["squads"].sort(key=lambda squad: int(squad["id"]))
        for squad in team["squads"]:
            squad["players"].sort(key=lambda person: (not person["leader"], person["name"].lower()))
        team["loose"].sort(key=lambda person: person["name"].lower())
        team["count"] = sum(len(squad["players"]) for squad in team["squads"]) + len(team["loose"])
    ordered = [teams[key_id] for key_id in ("1", "2") if key_id in teams]
    return {
        "ok": True,
        "teams": ordered,
        "ms": data.get("ms"),
        "cached": bool(data.get("cached")),
        "via": data.get("via") or "legacy",
    }


def roster(key: str) -> dict:
    """Fast path: game-host agent. Dedup parallel polls from PM2 workers."""
    with _roster_inflight_lock:
        ev = _roster_inflight.get(key)
        if ev is not None:
            waiter = ev
        else:
            waiter = None
            _roster_inflight[key] = threading.Event()
    if waiter is not None:
        waiter.wait(timeout=25)
        cached = _roster_inflight_result.get(key)
        if cached:
            return cached
    try:
        try:
            raw = agent_request("GET", f"/roster?key={key}&light=1", timeout=22)
            raw["via"] = "agent"
            result = _parse_roster_payload(raw)
        except Exception as agent_err:
            # fallback legacy REMOTE (still safe)
            data = ssh_job({"op": "roster", "key": key})
            data["via"] = f"legacy:{type(agent_err).__name__}"
            result = _parse_roster_payload(data)
        _roster_inflight_result[key] = result
        return result
    finally:
        with _roster_inflight_lock:
            done = _roster_inflight.pop(key, None)
            if done:
                done.set()


def layers() -> dict:
    data = ssh_job({"op": "layers"}, timeout=55)
    if data.get("ok") is False:
        return data
    text = data.get("text") or ""
    grouped: dict[str, list[str]] = {"SQ": [], **{name: [] for name in MODS}}
    by_id = {mod_id: name for name, mod_id in MODS.items()}
    seen: set[tuple[str, str]] = set()
    for line in text.splitlines():
        raw = line.strip()
        if not raw or raw.lower().startswith("list of"):
            continue
        match = re.match(r"^(\S+)\s+\((\d+)\)\s*$", raw)
        if match:
            layer, mod_id = match.group(1), match.group(2)
            mode = by_id.get(mod_id)
            if not mode or (mode, layer) in seen:
                continue
            seen.add((mode, layer))
            grouped[mode].append(layer)
            continue
        if not re.fullmatch(r"[A-Za-z0-9_]+", raw):
            continue
        if any(skip in raw for skip in SKIP_VANILLA):
            continue
        if ("SQ", raw) in seen:
            continue
        seen.add(("SQ", raw))
        grouped["SQ"].append(raw)
    for name in grouped:
        grouped[name].sort()
    if "LOADER" in grouped and "ModLoader_v1" in grouped["LOADER"]:
        rest = [x for x in grouped["LOADER"] if x != "ModLoader_v1"]
        grouped["LOADER"] = ["ModLoader_v1", *rest]
    return {
        "ok": True,
        "modes": grouped,
        "factions": [{"id": k, "label": v} for k, v in FACTIONS.items()],
        "decks": list(DECKS),
    }


def _clean_reason(raw: str, limit: int = 120) -> str:
    text = re.sub(r"[\r\n\t]+", " ", raw or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _extra_payload() -> dict:
    raw = os.environ.get("PANELKA_JSON") or ""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _unit_token(faction: str, deck: str) -> str:
    faction = faction.strip().upper()
    deck = deck.strip()
    if not faction:
        return ""
    if faction not in FACTIONS:
        raise SystemExit("неизвестная фракция")
    if deck:
        if deck not in DECKS:
            raise SystemExit("неизвестная дека")
        return f"{faction}+{deck}"
    return faction


def command(key: str, action: str, layer: str, steam_id: str) -> dict:
    extra = _extra_payload()
    reason = _clean_reason(str(extra.get("reason") or ""))
    duration = str(extra.get("duration") or "").strip()
    by_nick = _clean_reason(str(extra.get("byNick") or "панель"), 32)
    by_steam = str(extra.get("bySteamId") or "")
    target_name = _clean_reason(str(extra.get("targetName") or ""), 48)
    action_log = None
    if action == "restart":
        cmd = "AdminRestartMatch"
    elif action == "end":
        cmd = "AdminEndMatch"
    elif action in ("change-now", "change-next"):
        unit1 = _unit_token(str(extra.get("faction1") or ""), str(extra.get("deck1") or ""))
        unit2 = _unit_token(str(extra.get("faction2") or ""), str(extra.get("deck2") or ""))
        parts = [layer]
        if unit1 and unit2:
            if unit1.split("+", 1)[0] == unit2.split("+", 1)[0]:
                raise SystemExit("фракции команд должны отличаться")
            parts.extend([unit1, unit2])
        elif unit1 or unit2:
            raise SystemExit("укажи фракции для обеих команд")
        verb = "AdminChangeLayer" if action == "change-now" else "AdminSetNextLayer"
        cmd = " ".join([verb, *parts])
    elif action == "kick":
        why = reason or "panelka"
        why = f"[{by_nick}] {why}"
        cmd = f"AdminKick {steam_id} {why}"
        action_log = {"kind": "kick", "reason": why}
    elif action == "ban":
        if not reason:
            raise SystemExit("нужна причина")
        if not re.fullmatch(r"0|\d+[mhd]", duration, re.I):
            raise SystemExit("срок: 30m / 1h / 1d / 0")
        why = f"[{by_nick}] {reason}"
        cmd = f'AdminBan {steam_id} "{duration}" {why}'
        action_log = {"kind": "ban", "reason": why, "duration": duration}
    elif action == "team":
        cmd = f"AdminForceTeamChange {steam_id}"
        action_log = {"kind": "team", "reason": "перекинул команду"}
    elif action == "unsquad":
        cmd = f"AdminRemovePlayerFromSquad {steam_id}"
        action_log = {"kind": "unsquad", "reason": "выгнал с отряда"}
    elif action in ("disband-squad", "rename-squad"):
        team_id = str(extra.get("teamId") or "").strip()
        squad_id = str(extra.get("squadId") or "").strip()
        squad_name = _clean_reason(str(extra.get("squadName") or ""), 48)
        if team_id not in ("1", "2") or not re.fullmatch(r"\d{1,3}", squad_id):
            raise SystemExit("укажи команду и номер отряда")
        if action == "disband-squad":
            cmd = f"AdminDisbandSquad {team_id} {squad_id}"
            action_log = {
                "kind": "disband",
                "reason": f"распустил отряд {squad_id}"
                + (f" «{squad_name}»" if squad_name else ""),
            }
        else:
            cmd = f"AdminRenameSquad {team_id} {squad_id}"
            action_log = {
                "kind": "rename",
                "reason": f"сбросил имя отряда {squad_id}"
                + (f" «{squad_name}»" if squad_name else ""),
            }
        if not target_name:
            target_name = squad_name or f"Squad {squad_id}"
    elif action == "warn":
        msg = reason or _clean_reason(layer, 160)
        if not msg:
            raise SystemExit("напиши сообщение игроку")
        msg = f"[{by_nick}] {msg}"
        # Squad AdminWarn ломается на слишком длинных UTF-8 строках
        if len(msg.encode("utf-8")) > 140:
            msg = msg.encode("utf-8")[:140].decode("utf-8", "ignore").rstrip()
        cmd = f"AdminWarn {steam_id} {msg}"
        action_log = {"kind": "warn", "reason": msg}
    elif action == "say":
        text = _clean_reason(layer, 160)
        if not text:
            raise SystemExit("напиши короткое сообщение")
        cmd = f"AdminBroadcast {text}"
    else:
        raise SystemExit("bad action")
    from datetime import datetime, timedelta, timezone

    msk = timezone(timedelta(hours=3))
    now = datetime.now(msk)
    # Prefer agent P0 queue for instant moderation commands.
    try:
        data = agent_request(
            "POST",
            "/cmd",
            {"key": key, "command": cmd},
            timeout=22,
        )
        if data.get("ok") is False:
            raise RuntimeError(data.get("error") or "agent cmd fail")
        reply = (data.get("text") or "").strip()
        via = "agent"
    except Exception:
        job: dict = {"op": "cmd", "key": key, "command": cmd}
        if action_log:
            job["actionLog"] = {
                **action_log,
                "key": key,
                "steamId": steam_id,
                "name": target_name,
                "byNick": by_nick,
                "bySteamId": by_steam,
                "date": now.strftime("%Y-%m-%d"),
                "clock": now.strftime("%H:%M:%S"),
            }
        data = ssh_job(job)
        if data.get("ok") is False:
            return data
        reply = (data.get("text") or "").strip()
        via = "legacy"
        action_log = None  # already logged by REMOTE
    if action_log and via == "agent":
        # Best-effort staff log via legacy append on game host
        try:
            ssh_job(
                {
                    "op": "cmd",
                    "key": key,
                    "command": "ShowCurrentMap",
                    "actionLog": {
                        **action_log,
                        "key": key,
                        "steamId": steam_id,
                        "name": target_name,
                        "byNick": by_nick,
                        "bySteamId": by_steam,
                        "date": now.strftime("%Y-%m-%d"),
                        "clock": now.strftime("%H:%M:%S"),
                    },
                },
                timeout=15,
            )
        except Exception:
            pass
    return {"ok": True, "reply": reply or "команда ушла на сервер", "via": via, "ms": data.get("ms")}


def player_card(key: str, steam_id: str, name: str) -> dict:
    data = ssh_job(
        {
            "op": "player-card",
            "key": key,
            "steamId": steam_id,
            "name": name,
        }
    )
    if data.get("ok") is False:
        return data
    return {
        "ok": True,
        "chat": data.get("chat") or [],
        "teamkills": data.get("teamkills") or [],
        "punishments": data.get("punishments") or [],
    }


def parse_mod_id(raw: str) -> str:
    text = (raw or "").strip()
    match = re.search(r"(?:[?&]id=|/filedetails/\?id=)(\d{5,12})", text, re.I)
    if match:
        return match.group(1)
    if re.fullmatch(r"\d{5,12}", text):
        return text
    raise SystemExit("нужен ID мода или ссылка Steam Workshop")


def workshop_details(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    try:
        from urllib.parse import urlencode
        from urllib.request import Request, urlopen
    except ImportError:
        return {}
    payload = [("itemcount", str(len(ids)))]
    for index, mid in enumerate(ids):
        payload.append((f"publishedfileids[{index}]", mid))
    req = Request(
        "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
        data=urlencode(payload).encode("utf-8"),
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return {}
    out: dict[str, dict] = {}
    for row in ((data.get("response") or {}).get("publishedfiledetails") or []):
        mid = str(row.get("publishedfileid") or "")
        if not mid:
            continue
        out[mid] = {
            "title": str(row.get("title") or "")[:80],
            "timeUpdated": int(row.get("time_updated") or 0),
            "timeCreated": int(row.get("time_created") or 0),
            "banned": int(row.get("banned") or 0),
        }
    return out


def mods_list(key: str) -> dict:
    data = ssh_job({"op": "mods", "key": key}, timeout=40)
    if data.get("ok") is False:
        return data
    rows = list(data.get("mods") or [])
    details = workshop_details([str(row.get("id")) for row in rows if row.get("id")])
    enriched = []
    for row in rows:
        mid = str(row.get("id"))
        steam = details.get(mid) or {}
        local_updated = int(row.get("localUpdated") or 0)
        steam_updated = int(steam.get("timeUpdated") or 0)
        enriched.append(
            {
                "id": mid,
                "title": steam.get("title") or row.get("title") or mid,
                "localUpdated": local_updated,
                "steamUpdated": steam_updated,
                "needsUpdate": bool(steam_updated and steam_updated > local_updated),
                "inLoadOrder": bool(row.get("inLoadOrder")),
            }
        )
    return {"ok": True, "mods": enriched, "order": data.get("order") or []}


def mod_install(key: str, raw: str) -> dict:
    mid = parse_mod_id(raw)
    meta = workshop_details([mid]).get(mid) or {"publishedfileid": mid}
    # remap steam fields for info.json like the bot expects
    info = {
        "publishedfileid": mid,
        "title": meta.get("title") or mid,
        "time_updated": int(meta.get("timeUpdated") or int(time.time())),
        "time_created": int(meta.get("timeCreated") or 0),
    }
    data = ssh_job(
        {"op": "mod-install", "key": key, "modId": mid, "meta": info},
        timeout=420,
    )
    return data


def mod_remove(key: str, raw: str) -> dict:
    mid = parse_mod_id(raw)
    return ssh_job({"op": "mod-remove", "key": key, "modId": mid}, timeout=40)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "нет команды"}))
        return 1
    op = sys.argv[1]
    try:
        try:
            sync_panelka_agent(force=False)
        except Exception as sync_err:
            # Do not revive legacy chat bots while migrating to agent — that steals RCON.
            print(f"agent-sync-softfail:{type(sync_err).__name__}", file=sys.stderr)
        if op == "sync-agent":
            sync_panelka_agent(force=True)
            result = {"ok": True, "reply": "agent synced"}
        elif op == "sim":
            key = sys.argv[2] if len(sys.argv) > 2 else "PB1"
            if key not in KEYS:
                raise SystemExit("bad server")
            # Safe: only List*/ShowCurrentMap via agent /sim — never mutates match
            result = agent_request(
                "POST",
                "/sim",
                {"key": key, "rounds": 3},
                timeout=45,
            )
        elif op == "agent-metrics":
            result = agent_request("GET", "/metrics", timeout=10)
        elif op == "status":
            result = status()
        elif op == "players":
            key = sys.argv[2]
            if key not in KEYS:
                raise SystemExit("bad server")
            result = players(key)
        elif op == "roster":
            key = sys.argv[2]
            if key not in KEYS:
                raise SystemExit("bad server")
            result = roster(key)
        elif op == "layers":
            result = layers()
        elif op == "chat":
            key = sys.argv[2]
            if key not in KEYS:
                raise SystemExit("bad server")
            try:
                result = agent_request("GET", f"/chat?key={key}", timeout=12)
            except Exception:
                result = ssh_job({"op": "chat", "key": key})
        elif op == "player-card":
            key = sys.argv[2]
            steam_id = sys.argv[3] if len(sys.argv) > 3 else ""
            extra = _extra_payload()
            name = str(extra.get("name") or "")
            if key not in KEYS:
                raise SystemExit("bad server")
            if not re.fullmatch(r"7656\d{13}", steam_id):
                raise SystemExit("bad steam")
            result = player_card(key, steam_id, name)
        elif op == "staff-log":
            extra = _extra_payload()
            lim = int(extra.get("limit") or 400)
            result = ssh_job({"op": "staff-log", "limit": lim}, timeout=25)
        elif op == "mods":
            key = sys.argv[2]
            if key not in KEYS:
                raise SystemExit("bad server")
            result = mods_list(key)
        elif op == "mod-install":
            key = sys.argv[2]
            raw = sys.argv[3] if len(sys.argv) > 3 else ""
            extra = _extra_payload()
            if not raw:
                raw = str(extra.get("mod") or extra.get("modId") or "")
            if key not in KEYS:
                raise SystemExit("bad server")
            result = mod_install(key, raw)
        elif op == "mod-remove":
            key = sys.argv[2]
            raw = sys.argv[3] if len(sys.argv) > 3 else ""
            extra = _extra_payload()
            if not raw:
                raw = str(extra.get("mod") or extra.get("modId") or "")
            if key not in KEYS:
                raise SystemExit("bad server")
            result = mod_remove(key, raw)
        elif op == "cmd":
            key, action = sys.argv[2], sys.argv[3]
            layer = sys.argv[4] if len(sys.argv) > 4 else ""
            steam_id = sys.argv[5] if len(sys.argv) > 5 else ""
            if key not in KEYS:
                raise SystemExit("bad server")
            if action in ("change-now", "change-next") and not re.fullmatch(r"[A-Za-z0-9_]+", layer):
                raise SystemExit("bad layer")
            if action in ("kick", "ban", "team", "unsquad", "warn") and not re.fullmatch(
                r"7656\d{13}", steam_id
            ):
                raise SystemExit("bad steam")
            if action in ("disband-squad", "rename-squad"):
                extra = _extra_payload()
                team_id = str(extra.get("teamId") or "").strip()
                squad_id = str(extra.get("squadId") or "").strip()
                if team_id not in ("1", "2") or not re.fullmatch(r"\d{1,3}", squad_id):
                    raise SystemExit("bad squad")
            result = command(key, action, layer, steam_id)
        else:
            raise SystemExit("bad op")
    except SystemExit as exc:
        print(json.dumps({"ok": False, "error": str(exc) or "ошибка"}, ensure_ascii=False))
        return 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

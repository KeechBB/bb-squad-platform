#!/usr/bin/env python3
"""RCON TR1–TR5 through the game-host SSH the collector already uses.

Prints JSON to stdout. Passwords stay in Rcon.cfg on the game host.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from pathlib import Path

import paramiko

KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5")
MODS = {
    "FCL": "3569460354",
    "CSL": "3294562930",
    "SEC": "3661196801",
}

REMOTE = r'''
import json, re, socket, struct, sys, base64
from concurrent.futures import ThreadPoolExecutor
job = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))

def rcon(key, cmd):
    cfg_path = f"/home/squad/servers/{key}/SquadGame/ServerConfig/Rcon.cfg"
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
    try:
        s.close()
    except Exception:
        pass
    return "".join(parts)

def ensure_chat_listener():
    import os, subprocess
    pid_path = "/tmp/bb_panelka_chat.pid"
    script = "/home/squad/bb_panelka_chat.py"
    if not os.path.isfile(script):
        return
    pid = ""
    if os.path.isfile(pid_path):
        pid = open(pid_path, encoding="utf-8").read().strip()
    if pid.isdigit() and os.path.isdir(f"/proc/{pid}"):
        return
    proc = subprocess.Popen(
        ["python3", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    open(pid_path, "w", encoding="utf-8").write(str(proc.pid))

def read_chat(key):
    import json, os, re
    ensure_chat_listener()
    spoken = []
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
            spoken.append({
                "clock": row.get("clock") or "",
                "channel": row.get("channel") or "чат",
                "name": (row.get("name") or "")[:48],
                "text": (row.get("text") or "")[:240],
            })
    log_path = f"/home/squad/servers/{key}/SquadGame/Saved/Logs/SquadGame.log"
    casts = []
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 2_000_000))
            blob = handle.read().decode("utf-8", "replace")
        cast_re = re.compile(r"Message broadcasted <(.*)> from RCON")
        clock_re = re.compile(r"\[(\d{4}\.\d{2}\.\d{2})-(\d{2})\.(\d{2})\.(\d{2})")
        for line in blob.splitlines():
            cast = cast_re.search(line)
            if not cast:
                continue
            clock_m = clock_re.search(line)
            clock = ""
            if clock_m:
                hour = (int(clock_m.group(2)) + 3) % 24
                clock = f"{hour:02d}:{clock_m.group(3)}:{clock_m.group(4)}"
            casts.append({"clock": clock, "channel": "всем", "name": "Админ", "text": cast.group(1).strip()})
    except Exception:
        pass
    return (casts[-15:] + spoken[-60:])[-60:]

def server_row(key):
    info = rcon(key, "ShowServerInfo")
    current = rcon(key, "ShowCurrentMap")
    return {"key": key, "info": info, "current": current}

op = job.get("op")
try:
    if op == "status":
        keys = list(job["keys"])
        def one(key):
            try:
                return server_row(key)
            except Exception as e:
                return {"key": key, "error": str(e)}
        with ThreadPoolExecutor(max_workers=5) as pool:
            rows = list(pool.map(one, keys))
        print(json.dumps({"ok": True, "rows": rows}, ensure_ascii=False))
    elif op == "players":
        print(json.dumps({"ok": True, "text": rcon(job["key"], "ListPlayers")}, ensure_ascii=False))
    elif op == "roster":
        print(json.dumps({
            "ok": True,
            "players": rcon(job["key"], "ListPlayers"),
            "squads": rcon(job["key"], "ListSquads"),
        }, ensure_ascii=False))
    elif op == "layers":
        print(json.dumps({"ok": True, "text": rcon("TR1", "ListLayers")}, ensure_ascii=False))
    elif op == "cmd":
        print(json.dumps({"ok": True, "text": rcon(job["key"], job["command"])}, ensure_ascii=False))
    elif op == "chat":
        key = job["key"]
        if key not in ("TR1", "TR2", "TR3", "TR4", "TR5"):
            print(json.dumps({"ok": False, "error": "нет такого сервера"}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": True, "messages": read_chat(key)}, ensure_ascii=False))
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


def ssh_job(job: dict) -> dict:
    load_env()
    host = os.environ["SQUAD_SSH_HOST"]
    port = int(os.environ.get("SQUAD_SSH_PORT") or 2022)
    user = os.environ.get("SQUAD_SSH_USER") or "squad"
    password = os.environ["SQUAD_SSH_PASSWORD"]
    payload = base64.b64encode(json.dumps(job).encode("utf-8")).decode("ascii")
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
    try:
        sftp = client.open_sftp()
        with sftp.file("/tmp/bb_panelka_rcon.py", "w") as handle:
            handle.write(REMOTE)
        sftp.close()
        _, stdout, stderr = client.exec_command(
            f"python3 /tmp/bb_panelka_rcon.py {payload}",
            timeout=40,
        )
        out = stdout.read().decode("utf-8", "replace").strip()
        err = stderr.read().decode("utf-8", "replace").strip()
    finally:
        client.close()
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


STATUS_CACHE = Path("/tmp/bb-panelka-status.json")


def status() -> dict:
    if STATUS_CACHE.is_file():
        age = time.time() - STATUS_CACHE.stat().st_mtime
        if age < 12:
            try:
                cached = json.loads(STATUS_CACHE.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                cached = None
            if isinstance(cached, dict) and cached.get("ok") and cached.get("servers"):
                return cached
    data = ssh_job({"op": "status", "keys": list(KEYS)})
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
                    "error": row["error"],
                }
            )
            continue
        info = parse_info(row.get("info") or "")
        map_name, layer = pretty_map(row.get("current") or "", info)
        try:
            players = int(info.get("PlayerCount_I") or 0)
        except (TypeError, ValueError):
            players = 0
        try:
            max_players = int(info.get("MaxPlayers") or 100)
        except (TypeError, ValueError):
            max_players = 100
        servers.append(
            {
                "key": key,
                "name": str(info.get("ServerName_s") or key).strip() or key,
                "map": map_name,
                "layer": layer,
                "players": players,
                "maxPlayers": max_players,
                "error": None,
            }
        )
    result = {"ok": True, "servers": servers}
    if any(not row.get("error") for row in servers):
        try:
            STATUS_CACHE.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    return result


PLAYER_RE = re.compile(
    r"ID:\s*(?P<id>\d+)\s*\|\s*Online IDs:\s*(?P<ids>.*?)\s*\|\s*Name:\s*(?P<name>.*?)\s*\|\s*Team ID:\s*(?P<team>[^|]+)\|\s*Party ID:\s*[^|]*\|\s*Squad ID:\s*(?P<squad>[^|]+)\|\s*Is Leader:\s*(?P<leader>[^|]+)\|\s*Role:\s*(?P<role>[^|]+)",
    re.I,
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
        rows.append(
            {
                "id": int(match.group("id")),
                "name": name,
                "steamId": steam_m.group(1),
                "team": team if team in ("1", "2") else "",
                "squad": squad if squad.isdigit() else "",
                "leader": match.group("leader").strip().lower() == "true",
                "role": role_label(role),
            }
        )
    rows.sort(key=lambda row: (row["team"] or "9", row["name"].lower()))
    return rows


def players(key: str) -> dict:
    data = ssh_job({"op": "players", "key": key})
    if data.get("ok") is False:
        return data
    return {"ok": True, "players": parse_player_rows(data.get("text") or "")}


def roster(key: str) -> dict:
    data = ssh_job({"op": "roster", "key": key})
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
                }
            )
    by_squad = {(team["id"], squad["id"]): squad for team in teams.values() for squad in team["squads"]}
    for person in parse_player_rows(data.get("players") or ""):
        team = teams.get(person["team"])
        if not team:
            continue
        squad = by_squad.get((person["team"], person["squad"]))
        bucket = squad["players"] if squad else team["loose"]
        bucket.append(
            {
                "id": person["id"],
                "name": person["name"],
                "steamId": person["steamId"],
                "leader": person["leader"],
                "role": person["role"],
            }
        )
    for team in teams.values():
        team["squads"].sort(key=lambda squad: int(squad["id"]))
        for squad in team["squads"]:
            squad["players"].sort(key=lambda person: (not person["leader"], person["name"].lower()))
        team["loose"].sort(key=lambda person: person["name"].lower())
        team["count"] = sum(len(squad["players"]) for squad in team["squads"]) + len(team["loose"])
    ordered = [teams[key_id] for key_id in ("1", "2") if key_id in teams]
    return {"ok": True, "teams": ordered}


def layers() -> dict:
    data = ssh_job({"op": "layers"})
    if data.get("ok") is False:
        return data
    text = data.get("text") or ""
    grouped = {name: [] for name in MODS}
    by_id = {mod_id: name for name, mod_id in MODS.items()}
    seen: set[tuple[str, str]] = set()
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+\((\d+)\)\s*$", line.strip())
        if not match:
            continue
        layer, mod_id = match.group(1), match.group(2)
        mode = by_id.get(mod_id)
        if not mode or (mode, layer) in seen:
            continue
        seen.add((mode, layer))
        grouped[mode].append(layer)
    for name in grouped:
        grouped[name].sort()
    return {"ok": True, "modes": grouped}


def command(key: str, action: str, layer: str, steam_id: str) -> dict:
    if action == "restart":
        cmd = "AdminRestartMatch"
    elif action == "end":
        cmd = "AdminEndMatch"
    elif action == "change-now":
        cmd = f"AdminChangeLayer {layer}"
    elif action == "change-next":
        cmd = f"AdminSetNextLayer {layer}"
    elif action == "kick":
        cmd = f"AdminKick {steam_id} panelka"
    elif action == "team":
        cmd = f"AdminForceTeamChange {steam_id}"
    elif action == "say":
        text = re.sub(r"[\r\n\t]+", " ", layer)
        text = re.sub(r"\s+", " ", text).strip()
        if not text or len(text) > 160:
            raise SystemExit("напиши короткое сообщение")
        cmd = f"AdminBroadcast {text}"
    else:
        raise SystemExit("bad action")
    data = ssh_job({"op": "cmd", "key": key, "command": cmd})
    if data.get("ok") is False:
        return data
    reply = (data.get("text") or "").strip()
    return {"ok": True, "reply": reply or "команда ушла на сервер"}


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "нет команды"}))
        return 1
    op = sys.argv[1]
    try:
        if op == "status":
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
            result = ssh_job({"op": "chat", "key": key})
        elif op == "cmd":
            key, action = sys.argv[2], sys.argv[3]
            layer = sys.argv[4] if len(sys.argv) > 4 else ""
            steam_id = sys.argv[5] if len(sys.argv) > 5 else ""
            if key not in KEYS:
                raise SystemExit("bad server")
            if action in ("change-now", "change-next") and not re.fullmatch(r"[A-Za-z0-9_]+", layer):
                raise SystemExit("bad layer")
            if action in ("kick", "team") and not re.fullmatch(r"7656\d{13}", steam_id):
                raise SystemExit("bad steam")
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

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

KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5", "PB1")
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
def host(key):
    return HOST.get(key, key)

def rcon(key, cmd):
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
    pid_path = "/tmp/bb_panelka_chat.pid"
    script = "/home/squad/bb_panelka_chat.py"
    if not os.path.isfile(script):
        return
    body = open(script, encoding="utf-8", errors="replace").read()
    changed = False
    if 'PB1' not in body.split("KEYS", 1)[-1][:120]:
        nl = chr(10)
        body2 = body.replace(
            'KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5")',
            'KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5", "PB1")' + nl + 'HOST = {"PB1": "TPUB1"}' + nl + 'def _host(key):' + nl + '    return HOST.get(key, key)',
        )
        if body2 != body:
            body = body2
            changed = True
    if 'def _host(' in body and '/servers/{key}/SquadGame/ServerConfig/Rcon.cfg' in body:
        body = body.replace(
            'f"/home/squad/servers/{key}/SquadGame/ServerConfig/Rcon.cfg"',
            'f"/home/squad/servers/{_host(key)}/SquadGame/ServerConfig/Rcon.cfg"',
        )
        changed = True
    if changed:
        open(script, "w", encoding="utf-8").write(body)
        if os.path.isfile(pid_path):
            old = open(pid_path, encoding="utf-8").read().strip()
            if old.isdigit():
                try:
                    os.kill(int(old), 15)
                except Exception:
                    pass
                time.sleep(0.5)
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
    import json, re
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
                "date": row.get("date") or "",
                "channel": row.get("channel") or "чат",
                "name": (row.get("name") or "")[:48],
                "text": (row.get("text") or "")[:240],
            })
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
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

def read_player_card(key, steam_id, name):
    import json, os, re
    ensure_chat_listener()
    want_name = (name or "").strip().lower()
    chat = []
    path = "/home/squad/bb-panelka-chat.jsonl"
    if os.path.isfile(path):
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()[-2000:]
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
    log_path = f"/home/squad/servers/{host(key)}/SquadGame/Saved/Logs/SquadGame.log"
    try:
        with open(log_path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 5_000_000))
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

    return {"ok": True, "chat": chat, "teamkills": teamkills}

def server_row(key):
    info = rcon(key, "ShowServerInfo")
    current = rcon(key, "ShowCurrentMap")
    return {"key": key, "info": info, "current": current}

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


def ssh_job(job: dict, timeout: int = 40) -> dict:
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
            timeout=timeout,
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


STATUS_CACHE = Path("/tmp/bb-panelka-status-v2.json")


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
        cmd = f"AdminKick {steam_id} {why}"
    elif action == "ban":
        if not reason:
            raise SystemExit("нужна причина")
        if not re.fullmatch(r"0|\d+[mhd]", duration, re.I):
            raise SystemExit("срок: 30m / 1h / 1d / 0")
        cmd = f'AdminBan {steam_id} "{duration}" {reason}'
    elif action == "team":
        cmd = f"AdminForceTeamChange {steam_id}"
    elif action == "unsquad":
        cmd = f"AdminRemovePlayerFromSquad {steam_id}"
    elif action == "warn":
        msg = reason or _clean_reason(layer, 160)
        if not msg:
            raise SystemExit("напиши сообщение игроку")
        cmd = f"AdminWarn {steam_id} {msg}"
    elif action == "say":
        text = _clean_reason(layer, 160)
        if not text:
            raise SystemExit("напиши короткое сообщение")
        cmd = f"AdminBroadcast {text}"
    else:
        raise SystemExit("bad action")
    data = ssh_job({"op": "cmd", "key": key, "command": cmd})
    if data.get("ok") is False:
        return data
    reply = (data.get("text") or "").strip()
    return {"ok": True, "reply": reply or "команда ушла на сервер"}


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

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-server Squad log fleet (TR1…TRn, PB1/TPUB1, …).

One layout for N servers — no per-server hardcode growth:
  {BB_LOG_CACHE_ROOT}/{SERVER}/SquadGame.log
  {BB_LOG_CACHE_ROOT}/{SERVER}/pins/SquadGame-{YYYY.MM.DD}-{matchId}.log

Legacy caches (_tmp_tr1_logs_cache, _tmp_tr2_logs_cache) still readable.

Env:
  SQUAD_SERVERS=TR1,TR2,TPUB1[,TR3…]
  BB_LOG_CACHE_ROOT=…/scripts/_tmp_squad_logs
  BB_LOG_SYNC_WORKERS=4          # parallel SSH
  BB_TRAIN_SYNC_SERVERS=TR1,TR2  # optional subset for train digitize
  BB_PUBLIC_SYNC_SERVERS=TPUB1,PB1
"""
from __future__ import annotations

import os
import re
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Canon aliases: site/docs say PB1, folder on game host is often TPUB1
SERVER_ALIASES = {
    "PB1": "TPUB1",
    "PUB": "TPUB1",
    "PUBLIC": "TPUB1",
}


def load_env() -> dict[str, str]:
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
    for k, v in os.environ.items():
        if k.startswith(("SQUAD_", "BB_")):
            out[k] = v
    return out


def canon_server(key: str) -> str:
    k = str(key or "").strip().upper()
    return SERVER_ALIASES.get(k, k)


def parse_server_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[\s,;]+", raw.strip()):
        if not part:
            continue
        c = canon_server(part)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def all_servers(env: dict[str, str] | None = None) -> list[str]:
    env = env or load_env()
    listed = parse_server_list(env.get("SQUAD_SERVERS"))
    if listed:
        return listed
    # fallback single-server legacy
    one = canon_server(env.get("SQUAD_SERVER_KEY") or "TR1")
    return [one]


def is_train_server(key: str) -> bool:
    """TR1, TR2, TR3… — training digitize + train RP."""
    k = canon_server(key)
    return bool(re.fullmatch(r"TR\d+", k))


def is_public_server(key: str) -> bool:
    k = canon_server(key)
    return k in {"TPUB1", "PB1", "PUB"} or k.startswith("TPUB") or k.startswith("PB")


def train_servers(env: dict[str, str] | None = None) -> list[str]:
    env = env or load_env()
    override = parse_server_list(env.get("BB_TRAIN_SYNC_SERVERS"))
    if override:
        return override
    return [s for s in all_servers(env) if is_train_server(s)]


def public_servers(env: dict[str, str] | None = None) -> list[str]:
    env = env or load_env()
    override = parse_server_list(env.get("BB_PUBLIC_SYNC_SERVERS"))
    if override:
        return override
    return [s for s in all_servers(env) if is_public_server(s)]


def cache_root(env: dict[str, str] | None = None) -> Path:
    env = env or load_env()
    raw = (env.get("BB_LOG_CACHE_ROOT") or "").strip()
    if raw:
        return Path(raw)
    return HERE / "_tmp_squad_logs"


def server_cache(server: str, env: dict[str, str] | None = None) -> Path:
    """Unified per-server dir. Legacy TR1/TR2 dirs still work as fallbacks."""
    env = env or load_env()
    s = canon_server(server)
    primary = cache_root(env) / s
    primary.mkdir(parents=True, exist_ok=True)
    (primary / "pins").mkdir(parents=True, exist_ok=True)
    return primary


def legacy_caches(server: str) -> list[Path]:
    s = canon_server(server)
    out: list[Path] = []
    if s == "TR1":
        out.append(Path(os.environ.get("TR1_LOG_CACHE", str(HERE / "_tmp_tr1_logs_cache"))))
    if s == "TR2":
        out.append(Path(os.environ.get("TR2_LOG_CACHE", str(HERE / "_tmp_tr2_logs_cache"))))
    if s in {"TPUB1", "PB1"}:
        out.append(HERE / "_tmp_tpub1_logs_cache")
    return out


def all_search_dirs(server: str | None = None) -> list[Path]:
    """Dirs to search for a log file (pins + live + legacy)."""
    env = load_env()
    dirs: list[Path] = []
    servers = [canon_server(server)] if server else all_servers(env)
    if not server:
        # Also scan every TR*/TPUB* folder under root even if not in env yet
        root = cache_root(env)
        if root.is_dir():
            for child in sorted(root.iterdir()):
                if child.is_dir():
                    servers.append(child.name)
        servers = list(dict.fromkeys(servers))
    for s in servers:
        c = server_cache(s, env)
        dirs.append(c / "pins")
        dirs.append(c)
        for leg in legacy_caches(s):
            dirs.append(leg)
    # Dedup preserving order
    seen: set[str] = set()
    out: list[Path] = []
    for d in dirs:
        key = str(d.resolve()) if d.exists() else str(d)
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def live_local_name(server: str) -> str:
    """On-disk name for the rotating live log inside server cache."""
    return "SquadGame.log"


def pin_filename(server: str, date_ymd: str, mid: str) -> str:
    stamp = date_ymd.replace("-", ".")
    # Include server so TR3… pins never collide with TR1 same mid pattern
    return f"{canon_server(server)}-{stamp}-{mid}.log"


def is_rotating_name(name: str) -> bool:
    n = str(name or "")
    if n in {"SquadGame.log", "TR1-SquadGame.log", "TR2-SquadGame.log", "TPUB1-SquadGame.log"}:
        return True
    if re.fullmatch(r"TR\d+-SquadGame\.log", n):
        return True
    if n.endswith("-SquadGame.log") and "backup" not in n.lower():
        return True
    return False


def pin_match_log(
    log_path: Path,
    *,
    server: str,
    mid: str,
    date_ymd: str,
) -> str:
    """Copy rotating/source log → pins/{SERVER}-{date}-{mid}.log. Returns file name only."""
    s = canon_server(server)
    cache = server_cache(s)
    pins = cache / "pins"
    pins.mkdir(parents=True, exist_ok=True)
    name = pin_filename(s, date_ymd, mid)
    dest = pins / name
    if log_path.is_file():
        if not dest.is_file() or dest.stat().st_size < log_path.stat().st_size:
            shutil.copy2(log_path, dest)
            print(f"pin [{s}] {log_path.name} → pins/{name} ({dest.stat().st_size})", flush=True)
        else:
            print(f"pin [{s}] keep pins/{name} ({dest.stat().st_size})", flush=True)
    else:
        print(f"pin [{s}] WARN missing {log_path}", flush=True)
    return name


def resolve_log(
    log_name: str,
    *,
    mid: str = "",
    date_ymd: str = "",
    server: str | None = None,
) -> Path | None:
    name = str(log_name or "")
    candidates: list[Path] = []
    servers = [canon_server(server)] if server else [None]
    for s in servers:
        dirs = all_search_dirs(s)
        if mid and date_ymd:
            # Try with known server and all train/public servers
            try_servers = [canon_server(server)] if server else (
                train_servers() + public_servers()
            )
            for ts in try_servers:
                pinned = pin_filename(ts, date_ymd, mid)
                for d in all_search_dirs(ts):
                    candidates.append(d / pinned)
        if name and not is_rotating_name(name):
            for d in dirs:
                candidates.append(d / name)
        if name:
            for d in dirs:
                candidates.append(d / name)
    best: Path | None = None
    seen: set[str] = set()
    for p in candidates:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.is_file():
            if best is None or p.stat().st_size > best.stat().st_size:
                best = p
    return best


def infer_server_from_path(path: Path) -> str:
    parts = [p.upper() for p in path.parts]
    for p in parts:
        if re.fullmatch(r"TR\d+", p) or p in {"TPUB1", "PB1"}:
            return canon_server(p)
    name = path.name.upper()
    m = re.match(r"(TR\d+|TPUB\d+|PB\d+)-", name)
    if m:
        return canon_server(m.group(1))
    if "TPUB" in name or name.startswith("PB"):
        return "TPUB1"
    if "TR2" in name:
        return "TR2"
    return "TR1"


def _ssh_pull_server(server: str, env: dict[str, str]) -> list[Path]:
    """Download live log + last 3 backups for one server into its cache dir."""
    s = canon_server(server)
    cache = server_cache(s, env)
    try:
        import paramiko
    except ImportError as e:
        local = sorted(cache.glob("*.log")) + sorted((cache / "pins").glob("*.log"))
        for leg in legacy_caches(s):
            if leg.is_dir():
                local.extend(leg.glob("*.log"))
        if local:
            print(f"paramiko missing ({e}) — using local {s} cache", flush=True)
            return sorted({p.resolve(): p for p in local}.values())
        print(f"paramiko missing and no {s} cache: {e}", flush=True)
        return []

    host = env.get("SQUAD_SSH_HOST")
    user = env.get("SQUAD_SSH_USER")
    password = env.get("SQUAD_SSH_PASSWORD")
    if not host or not user or not password:
        print(f"SSH env missing — local {s} cache only", flush=True)
        return sorted(cache.glob("*.log"))

    port = int(env.get("SQUAD_SSH_PORT") or "2022")
    root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
    # PB1 alias → remote folder TPUB1
    remote_key = s
    remote_dir = f"{root}/{remote_key}/SquadGame/Saved/Logs"

    last_err: Exception | None = None
    for attempt in range(4):
        transport = None
        try:
            transport = paramiko.Transport((host, port))
            transport.banner_timeout = 120
            transport.connect(username=user, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            assert sftp is not None
            try:
                names = sftp.listdir(remote_dir)
            except FileNotFoundError:
                # try PB1 folder name if TPUB1 missing
                if s == "TPUB1":
                    remote_dir = f"{root}/PB1/SquadGame/Saved/Logs"
                    names = sftp.listdir(remote_dir)
                else:
                    raise
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
                lpath = cache / (live_local_name(s) if name == "SquadGame.log" else name)
                try:
                    st = sftp.stat(rpath)
                    if lpath.is_file() and lpath.stat().st_size == st.st_size:
                        continue
                    print(f"{s} sftp ← {name} ({st.st_size})", flush=True)
                    sftp.get(rpath, str(lpath))
                except Exception as e:
                    print(f"{s} skip {name}: {e}", flush=True)
            sftp.close()
            transport.close()
            break
        except Exception as e:
            last_err = e
            print(f"{s} ssh fail {attempt+1}: {type(e).__name__}: {e}", flush=True)
            try:
                if transport:
                    transport.close()
            except Exception:
                pass
            time.sleep(1 + attempt)
    else:
        print(f"{s} ssh gave up: {last_err}", flush=True)

    return sorted(cache.glob("*.log"))


def sync_servers_parallel(
    servers: list[str] | None = None,
    *,
    kind: str = "train",
) -> list[Path]:
    """
    Pull logs for many servers in parallel.
    kind=train → TR*; kind=public → PB/TPUB*; kind=all → SQUAD_SERVERS
    """
    env = load_env()
    if servers is None:
        if kind == "public":
            servers = public_servers(env)
        elif kind == "all":
            servers = all_servers(env)
        else:
            servers = train_servers(env)
    if not servers:
        print(f"fleet: no servers for kind={kind}", flush=True)
        return []

    try:
        workers = max(1, min(8, int(env.get("BB_LOG_SYNC_WORKERS") or "4")))
    except ValueError:
        workers = 4
    workers = min(workers, len(servers))
    print(f"fleet sync kind={kind} servers={servers} workers={workers}", flush=True)

    logs: list[Path] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_ssh_pull_server, s, env): s for s in servers}
        for fut in as_completed(futs):
            s = futs[fut]
            try:
                got = fut.result()
                logs.extend(got)
                print(f"fleet [{s}] logs={len(got)}", flush=True)
            except Exception as e:
                print(f"fleet [{s}] ERROR {type(e).__name__}: {e}", flush=True)
    # unique by resolve
    uniq: dict[str, Path] = {}
    for p in logs:
        try:
            uniq[str(p.resolve())] = p
        except OSError:
            uniq[str(p)] = p
    return list(uniq.values())

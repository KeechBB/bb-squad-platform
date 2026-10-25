#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Архив ВСЕХ логов Squad с игрового хоста → plaza, по папкам серверов.

Цель: через месяцы/годы перепарсить то, чего сегодня ещё не умеем.
Коллектор join/hits (bb-squad-collector) по-прежнему tail'ит live по SSH.
Digitize / RP / история читают и из этого архива (bb_log_fleet).

Layout (append-only для backup'ов):
  {BB_LOG_ARCHIVE_ROOT}/
    PB1/                 # remote TPUB1 → папка PB1
    TR1/ … TR5/
      YYYY-MM/
        SquadGame-backup-YYYY.MM.DD-HH.MM.SS.log
        ….log.gz         # старые сжаты
      _live/
        SquadGame.log    # зеркало текущего (перезаписывается)
      _state.json

Env (из .squad-collector.env):
  SQUAD_SSH_* , SQUAD_LOG_ROOT
  BB_LOG_ARCHIVE_ROOT=/var/www/bb-squad-logs
  BB_LOG_ARCHIVE_SERVERS=TR1,TR2,TR3,TR4,TR5,PB1   # пусто = discover remote
  BB_LOG_ARCHIVE_POLL_SEC=300
  BB_LOG_ARCHIVE_GZ_DAYS=90
  BB_LOG_ARCHIVE_ONCE=1   # один проход и выход (cron)
"""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Папка на диске (то, что просил Alex) ← ключ на game host
FOLDER_FROM_REMOTE = {
    "TPUB1": "PB1",
    "PB1": "PB1",
    "PUB": "PB1",
}
REMOTE_FROM_FOLDER = {
    "PB1": "TPUB1",
}

BACKUP_RE = re.compile(
    r"^SquadGame-backup-(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.log$"
)


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


def archive_root(env: dict[str, str]) -> Path:
    raw = (env.get("BB_LOG_ARCHIVE_ROOT") or "").strip()
    if raw:
        return Path(raw)
    return Path("/var/www/bb-squad-logs")


def folder_name(remote_or_alias: str) -> str:
    k = str(remote_or_alias or "").strip().upper()
    return FOLDER_FROM_REMOTE.get(k, k)


def remote_key(folder: str) -> str:
    f = str(folder or "").strip().upper()
    return REMOTE_FROM_FOLDER.get(f, f)


def month_dir_for_backup(name: str) -> str | None:
    m = BACKUP_RE.match(name)
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}"


def parse_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[\s,;]+", raw.strip()):
        if not part:
            continue
        f = folder_name(part)
        if f and f not in seen:
            seen.add(f)
            out.append(f)
    return out


def discover_remote_servers(sftp, root: str) -> list[str]:
    """Return folder names (PB1, TR1…) for every TR*/TPUB*/PB* under log root."""
    try:
        names = sftp.listdir(root)
    except FileNotFoundError:
        return []
    folders: list[str] = []
    for n in sorted(names):
        nu = n.upper()
        if re.fullmatch(r"TR\d+", nu) or nu.startswith("TPUB") or nu.startswith("PB"):
            folders.append(folder_name(nu))
    # unique
    return list(dict.fromkeys(folders))


def connect(env: dict[str, str]):
    import paramiko

    host = env.get("SQUAD_SSH_HOST")
    user = env.get("SQUAD_SSH_USER")
    password = env.get("SQUAD_SSH_PASSWORD")
    if not host or not user or not password:
        raise RuntimeError("SQUAD_SSH_HOST/USER/PASSWORD required")
    port = int(env.get("SQUAD_SSH_PORT") or "2022")
    transport = paramiko.Transport((host, port))
    transport.banner_timeout = 120
    transport.connect(username=user, password=password)
    sftp = paramiko.SFTPClient.from_transport(transport)
    assert sftp is not None
    return transport, sftp


def load_state(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def remote_logs_dir(env: dict[str, str], folder: str) -> str:
    root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
    rk = remote_key(folder)
    return f"{root}/{rk}/SquadGame/Saved/Logs"


def ensure_local(folder: str, env: dict[str, str]) -> Path:
    base = archive_root(env) / folder
    (base / "_live").mkdir(parents=True, exist_ok=True)
    return base


def sftp_get_atomic(sftp, rpath: str, lpath: Path) -> None:
    lpath.parent.mkdir(parents=True, exist_ok=True)
    tmp = lpath.with_suffix(lpath.suffix + ".part")
    if tmp.exists():
        tmp.unlink()
    sftp.get(rpath, str(tmp))
    tmp.replace(lpath)


def archive_server(folder: str, env: dict[str, str], *, full: bool) -> dict:
    """Pull all (or new) logs for one display folder. Returns stats."""
    stats = {"folder": folder, "new": 0, "skip": 0, "live": 0, "err": None}
    base = ensure_local(folder, env)
    state_path = base / "_state.json"
    state = load_state(state_path)
    files_state: dict = state.setdefault("files", {})

    transport = None
    try:
        transport, sftp = connect(env)
        remote_dir = remote_logs_dir(env, folder)
        try:
            names = sftp.listdir(remote_dir)
        except FileNotFoundError:
            # PB1 may live as PB1 on host
            if folder == "PB1":
                root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
                remote_dir = f"{root}/PB1/SquadGame/Saved/Logs"
                names = sftp.listdir(remote_dir)
            else:
                raise

        # --- live mirror (mutable) ---
        if "SquadGame.log" in names:
            rpath = f"{remote_dir}/SquadGame.log"
            lpath = base / "_live" / "SquadGame.log"
            st = sftp.stat(rpath)
            need = True
            if lpath.is_file() and lpath.stat().st_size == st.st_size:
                need = False
            if need:
                print(f"[{folder}] live ← SquadGame.log ({st.st_size})", flush=True)
                sftp_get_atomic(sftp, rpath, lpath)
                stats["live"] = 1
            files_state["SquadGame.log"] = {
                "size": int(st.st_size),
                "mtime": int(getattr(st, "st_mtime", 0) or 0),
                "local": str(lpath),
            }

        # --- immutable backups ---
        backups = sorted(
            n for n in names if n.startswith("SquadGame-backup-") and n.endswith(".log")
        )
        if not full:
            # still pull ALL missing; "full" only affects verbosity / force
            pass

        for name in backups:
            month = month_dir_for_backup(name) or "unknown"
            dest_dir = base / month
            dest = dest_dir / name
            dest_gz = dest.with_suffix(dest.suffix + ".gz")
            rpath = f"{remote_dir}/{name}"
            try:
                st = sftp.stat(rpath)
            except Exception as e:
                print(f"[{folder}] skip {name}: {e}", flush=True)
                stats["skip"] += 1
                continue

            # already archived (raw or gz) with same size → immutable skip
            if dest.is_file() and dest.stat().st_size == st.st_size:
                stats["skip"] += 1
                continue
            if dest_gz.is_file():
                # gz present — treat as done (don't re-download)
                stats["skip"] += 1
                continue
            if dest.is_file() and dest.stat().st_size != st.st_size:
                # size mismatch: keep old under .bad, fetch new (rotation edge)
                bad = dest.with_suffix(dest.suffix + f".bad-{int(time.time())}")
                dest.rename(bad)
                print(f"[{folder}] size mismatch → {bad.name}", flush=True)

            print(f"[{folder}] archive ← {month}/{name} ({st.st_size})", flush=True)
            sftp_get_atomic(sftp, rpath, dest)
            files_state[name] = {
                "size": int(st.st_size),
                "mtime": int(getattr(st, "st_mtime", 0) or 0),
                "local": str(dest),
                "month": month,
            }
            stats["new"] += 1

        sftp.close()
        transport.close()
        transport = None
    except Exception as e:
        stats["err"] = f"{type(e).__name__}: {e}"
        print(f"[{folder}] ERROR {stats['err']}", flush=True)
        try:
            if transport:
                transport.close()
        except Exception:
            pass

    state["files"] = files_state
    state["last_sync"] = datetime.now(timezone.utc).isoformat()
    state["last_stats"] = {k: v for k, v in stats.items() if k != "err"}
    if stats["err"]:
        state["last_error"] = stats["err"]
    save_state(state_path, state)

    # compress old backups
    compress_old(base, env)
    return stats


def compress_old(base: Path, env: dict[str, str]) -> int:
    try:
        days = int(env.get("BB_LOG_ARCHIVE_GZ_DAYS") or "90")
    except ValueError:
        days = 14
    if days < 1:
        return 0
    cutoff = time.time() - days * 86400
    n = 0
    for month_dir in base.iterdir():
        if not month_dir.is_dir() or month_dir.name.startswith("_"):
            continue
        for log in month_dir.glob("SquadGame-backup-*.log"):
            try:
                if log.stat().st_mtime > cutoff:
                    continue
                gz = Path(str(log) + ".gz")
                if gz.exists():
                    continue
                print(f"gzip ← {log.relative_to(base)}", flush=True)
                with log.open("rb") as src, gzip.open(gz, "wb", compresslevel=6) as dst:
                    shutil.copyfileobj(src, dst, length=1024 * 1024)
                # verify size > 0 then remove raw
                if gz.stat().st_size > 0:
                    log.unlink()
                    n += 1
            except Exception as e:
                print(f"gzip fail {log.name}: {e}", flush=True)
    return n


def resolve_server_folders(env: dict[str, str]) -> list[str]:
    listed = parse_list(env.get("BB_LOG_ARCHIVE_SERVERS"))
    if listed:
        return listed
    # default: all training + public that exist on host
    listed = parse_list(env.get("SQUAD_SERVERS"))
    # always include TR1–TR5 + PB1 even if not in collector list
    extras = ["TR1", "TR2", "TR3", "TR4", "TR5", "PB1"]
    for e in extras:
        if e not in listed:
            listed.append(e)
    # try discover
    try:
        transport, sftp = connect(env)
        root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
        found = discover_remote_servers(sftp, root)
        sftp.close()
        transport.close()
        for f in found:
            if f not in listed:
                listed.append(f)
    except Exception as e:
        print(f"discover skip: {e}", flush=True)
    return listed


def run_once(env: dict[str, str], *, full: bool = True) -> int:
    root = archive_root(env)
    root.mkdir(parents=True, exist_ok=True)
    folders = resolve_server_folders(env)
    print(f"archive root={root} servers={folders}", flush=True)
    try:
        workers = max(1, min(6, int(env.get("BB_LOG_ARCHIVE_WORKERS") or "3")))
    except ValueError:
        workers = 3
    workers = min(workers, len(folders) or 1)
    errors = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {
            pool.submit(archive_server, f, env, full=full): f for f in folders
        }
        for fut in as_completed(futs):
            f = futs[fut]
            try:
                st = fut.result()
                print(
                    f"done [{f}] new={st['new']} skip={st['skip']} live={st['live']}",
                    flush=True,
                )
                if st.get("err"):
                    errors += 1
            except Exception as e:
                errors += 1
                print(f"done [{f}] FATAL {e}", flush=True)
    # index README
    readme = root / "README.txt"
    if not readme.is_file():
        readme.write_text(
            "BlackBerry Squad log archive (immutable backups).\n"
            "Folders: PB1, TR1… — year-month / SquadGame-backup-*.log[.gz]\n"
            "_live/SquadGame.log = current mirror.\n"
            "Do not delete. Re-parse anytime.\n",
            encoding="utf-8",
        )
    return 0 if errors == 0 else 1


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    env = load_env()
    once = (
        "1" in (env.get("BB_LOG_ARCHIVE_ONCE") or "")
        or "--once" in argv
        or os.environ.get("BB_LOG_ARCHIVE_ONCE") == "1"
    )
    full = "--full" in argv or once
    try:
        poll = int(env.get("BB_LOG_ARCHIVE_POLL_SEC") or "300")
    except ValueError:
        poll = 300
    poll = max(60, poll)

    if once:
        return run_once(env, full=True)

    print(f"bb-squad-siphon loop poll={poll}s", flush=True)
    while True:
        try:
            run_once(env, full=True)
        except Exception as e:
            print(f"loop ERROR {type(e).__name__}: {e}", flush=True)
        time.sleep(poll)


if __name__ == "__main__":
    raise SystemExit(main())

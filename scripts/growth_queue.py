#!/usr/bin/env python3
"""After a training or clan-war pour: refresh accuracy and the growth ladders.

Detached. A second pour while a rebuild is running is picked up by the ladder
lock's next pass, and by the hourly backstop.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def kick_growth_and_accuracy(reason: str = "") -> None:
    """Queue accuracy (shots/hits) and rifle/medic/LAT. Safe to call twice."""
    py = sys.executable or "python3"
    acc = HERE / "build_train_accuracy_stats.py"
    growth = Path("/var/www/bb-jobs/rebuild_growth_ladders.py")
    if not growth.is_file():
        growth = HERE / "rebuild_growth_ladders.py"
    log_path = Path("/var/log/bb-growth-ladders.log")
    try:
        log_fh = log_path.open("a", encoding="utf-8")
    except OSError:
        log_fh = open(os.devnull, "w", encoding="utf-8")
    cwd = "/var/www/bb-squad-platform"
    if not Path(cwd).is_dir():
        cwd = str(HERE)
    if reason:
        try:
            log_fh.write(f"\nqueue {reason}\n")
            log_fh.flush()
        except OSError:
            pass
    if acc.is_file():
        subprocess.Popen(
            [py, "-u", str(acc), "--since", "2026-10-20"],
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            cwd=cwd,
        )
    if growth.is_file():
        subprocess.Popen(
            [py, "-u", str(growth)],
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            cwd=cwd,
        )
        print(f"growth+accuracy queued {reason}".strip(), flush=True)
    else:
        print("growth queue skip: script missing", flush=True)

# -*- coding: utf-8 -*-
"""Своя база бота регистрации. Сайтовая Postgres сюда не пишется."""
from __future__ import annotations

import csv
import io
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

NICK_RE = re.compile(r"^(.{2,32}?)\s*\(\s*([^()]{2,40})\s*\)\s*$")
STEAM_RE = re.compile(r"7656\d{13}")

STEP_NICK = "nick"
STEP_STEAM = "steam"
STEP_SITE = "site"
STEP_SUBS = "subs"
STEP_DONE = "done"
STEP_REMOVED = "removed"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def parse_nick(text: str) -> tuple[str, str] | None:
    raw = " ".join((text or "").replace("\n", " ").split())
    m = NICK_RE.match(raw)
    if not m:
        return None
    nick, name = m.group(1).strip(), m.group(2).strip()
    if len(nick) < 2 or len(name) < 2:
        return None
    return nick, name


def parse_steam(text: str) -> str | None:
    """SteamID64: 17 цифр с 7656, можно ссылкой steamcommunity.com/profiles/…"""
    found = list(dict.fromkeys(STEAM_RE.findall(text or "")))
    if len(found) != 1:
        return None
    return found[0]


def connect(path: Path) -> sqlite3.Connection:
    global _conn
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS applicants (
          tg_id INTEGER PRIMARY KEY,
          tg_username TEXT,
          tg_first TEXT,
          game_nick TEXT,
          real_name TEXT,
          step TEXT NOT NULL,
          site_user_id TEXT,
          alert_sig TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accepted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS hr (
          tg_id INTEGER PRIMARY KEY,
          note TEXT,
          appointed_by INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          tg_id INTEGER,
          kind TEXT NOT NULL,
          detail TEXT
        );
        CREATE INDEX IF NOT EXISTS events_tg ON events(tg_id, id);
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(applicants)")}
    if "steam_id" not in cols:
        conn.execute("ALTER TABLE applicants ADD COLUMN steam_id TEXT")
    for col in ("invite_channel", "invite_group"):
        if col not in cols:
            conn.execute(f"ALTER TABLE applicants ADD COLUMN {col} TEXT")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS applicants_steam_active
        ON applicants(steam_id)
        WHERE steam_id IS NOT NULL AND steam_id != '' AND step != 'removed'
        """
    )
    conn.commit()
    _conn = conn
    return conn


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _c() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("db is not open")
    return _conn


def event(tg_id: int | None, kind: str, detail: str = "") -> None:
    with _lock:
        _c().execute(
            "INSERT INTO events(at, tg_id, kind, detail) VALUES(?,?,?,?)",
            (now(), tg_id, kind, detail[:500]),
        )
        _c().commit()


def bootstrap_hr(ids: list[int]) -> None:
    with _lock:
        for tg_id in ids:
            _c().execute(
                """
                INSERT INTO hr(tg_id, note, appointed_by, created_at)
                VALUES(?, 'bootstrap', NULL, ?)
                ON CONFLICT(tg_id) DO NOTHING
                """,
                (tg_id, now()),
            )
        _c().commit()


def is_hr(tg_id: int) -> bool:
    row = _c().execute("SELECT 1 FROM hr WHERE tg_id=?", (tg_id,)).fetchone()
    return row is not None


def list_hr() -> list[sqlite3.Row]:
    return list(_c().execute("SELECT * FROM hr ORDER BY created_at").fetchall())


def add_hr(tg_id: int, note: str, by: int) -> bool:
    with _lock:
        cur = _c().execute(
            """
            INSERT INTO hr(tg_id, note, appointed_by, created_at)
            VALUES(?,?,?,?)
            ON CONFLICT(tg_id) DO NOTHING
            """,
            (tg_id, note[:80], by, now()),
        )
        _c().commit()
        return cur.rowcount > 0


def remove_hr(tg_id: int) -> str:
    with _lock:
        n = _c().execute("SELECT COUNT(*) AS n FROM hr").fetchone()["n"]
        if n <= 1:
            return "последнего кадровика снять нельзя"
        cur = _c().execute("DELETE FROM hr WHERE tg_id=?", (tg_id,))
        _c().commit()
        if cur.rowcount == 0:
            return "такого кадровика нет"
        return "снят"


def get_applicant(tg_id: int) -> sqlite3.Row | None:
    return _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()


def upsert_nick(tg_id: int, username: str, first: str, nick: str, name: str) -> str:
    """created, updated или same."""
    ts = now()
    with _lock:
        prev = _c().execute(
            "SELECT step, game_nick, real_name FROM applicants WHERE tg_id=?",
            (tg_id,),
        ).fetchone()
        if prev is None or prev["step"] == STEP_REMOVED:
            _c().execute(
                """
                INSERT INTO applicants(
                  tg_id, tg_username, tg_first, game_nick, real_name, step,
                  steam_id, site_user_id, alert_sig, created_at, updated_at, accepted_at
                ) VALUES(?,?,?,?,?,?,NULL,NULL,'',?,?,NULL)
                ON CONFLICT(tg_id) DO UPDATE SET
                  tg_username=excluded.tg_username,
                  tg_first=excluded.tg_first,
                  game_nick=excluded.game_nick,
                  real_name=excluded.real_name,
                  step=excluded.step,
                  steam_id=NULL,
                  site_user_id=NULL,
                  alert_sig='',
                  updated_at=excluded.updated_at,
                  accepted_at=NULL
                """,
                (tg_id, username, first, nick, name, STEP_STEAM, ts, ts),
            )
            kind = "created"
        elif prev["game_nick"] == nick and prev["real_name"] == name:
            _c().execute(
                "UPDATE applicants SET tg_username=?, tg_first=?, updated_at=? WHERE tg_id=?",
                (username, first, ts, tg_id),
            )
            kind = "same"
        else:
            _c().execute(
                """
                UPDATE applicants
                SET tg_username=?, tg_first=?, game_nick=?, real_name=?,
                    step=CASE
                      WHEN step IN ('steam','site','subs','done') THEN step
                      ELSE 'steam'
                    END,
                    alert_sig='', updated_at=?
                WHERE tg_id=?
                """,
                (username, first, nick, name, ts, tg_id),
            )
            kind = "updated"
        _c().commit()
    if kind != "same":
        event(tg_id, "step1", f"{nick} ({name})")
    return kind


def set_steam(tg_id: int, steam_id: str) -> str:
    """ok — записан, same — тот же, taken — уже у другой заявки, missing — нет анкеты."""
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        other = _c().execute(
            """
            SELECT tg_id FROM applicants
            WHERE steam_id=? AND tg_id!=? AND step!=?
            """,
            (steam_id, tg_id, STEP_REMOVED),
        ).fetchone()
        if other:
            return "taken"
        if row["steam_id"] == steam_id and row["step"] != STEP_STEAM:
            return "same"
        new_step = STEP_SITE if row["step"] in (STEP_STEAM, STEP_SITE, STEP_SUBS) else row["step"]
        if row["steam_id"] and row["steam_id"] != steam_id and row["step"] == STEP_DONE:
            new_step = STEP_SITE
        try:
            _c().execute(
                """
                UPDATE applicants
                SET steam_id=?,
                    step=?,
                    site_user_id=CASE WHEN steam_id IS NOT ? THEN NULL ELSE site_user_id END,
                    alert_sig='',
                    updated_at=?
                WHERE tg_id=?
                """,
                (steam_id, new_step, steam_id, ts, tg_id),
            )
            _c().commit()
        except sqlite3.IntegrityError:
            _c().rollback()
            return "taken"
    event(tg_id, "steam", steam_id)
    return "ok"


def set_step(tg_id: int, step: str, site_user_id: str | None = None, accepted: bool = False) -> None:
    ts = now()
    with _lock:
        if accepted:
            _c().execute(
                """
                UPDATE applicants
                SET step=?, site_user_id=COALESCE(?, site_user_id),
                    accepted_at=COALESCE(accepted_at, ?), updated_at=?, alert_sig=''
                WHERE tg_id=?
                """,
                (step, site_user_id, ts, ts, tg_id),
            )
        else:
            _c().execute(
                """
                UPDATE applicants
                SET step=?, site_user_id=COALESCE(?, site_user_id), updated_at=?
                WHERE tg_id=?
                """,
                (step, site_user_id, ts, tg_id),
            )
        _c().commit()


def mark_removed(tg_id: int) -> None:
    with _lock:
        _c().execute(
            "UPDATE applicants SET step=?, updated_at=?, alert_sig='' WHERE tg_id=?",
            (STEP_REMOVED, now(), tg_id),
        )
        _c().commit()


def set_invites(
    tg_id: int,
    *,
    channel: str | None = None,
    group: str | None = None,
) -> None:
    with _lock:
        if channel is not None:
            _c().execute(
                "UPDATE applicants SET invite_channel=?, updated_at=? WHERE tg_id=?",
                (channel or None, now(), tg_id),
            )
        if group is not None:
            _c().execute(
                "UPDATE applicants SET invite_group=?, updated_at=? WHERE tg_id=?",
                (group or None, now(), tg_id),
            )
        _c().commit()


def clear_invites(tg_id: int) -> tuple[str, str]:
    """Возвращает старые ссылки (channel, group) и обнуляет."""
    with _lock:
        row = _c().execute(
            "SELECT invite_channel, invite_group FROM applicants WHERE tg_id=?",
            (tg_id,),
        ).fetchone()
        ch = (row["invite_channel"] or "").strip() if row else ""
        gr = (row["invite_group"] or "").strip() if row else ""
        _c().execute(
            """
            UPDATE applicants
            SET invite_channel=NULL, invite_group=NULL, updated_at=?
            WHERE tg_id=?
            """,
            (now(), tg_id),
        )
        _c().commit()
        return ch, gr


def delete_applicant(tg_id: int) -> bool:
    with _lock:
        cur = _c().execute("DELETE FROM applicants WHERE tg_id=?", (tg_id,))
        _c().commit()
        return cur.rowcount > 0


def _split_alert_sig(raw: str | None) -> tuple[str, int]:
    """alert_sig: plain или `sig|unix` для hourly cooldown."""
    text = raw or ""
    if "|" not in text:
        return text, 0
    base, _, ts = text.rpartition("|")
    if ts.isdigit():
        return base, int(ts)
    return text, 0


def set_alert_sig(tg_id: int, sig: str, *, cooldown_sec: int | None = None) -> bool:
    """True, если алерт надо послать.

    Без cooldown — один раз на подпись.
    С cooldown — та же подпись снова не раньше чем через N секунд.
    """
    with _lock:
        row = _c().execute(
            "SELECT alert_sig FROM applicants WHERE tg_id=?", (tg_id,)
        ).fetchone()
        if row is None:
            return False
        raw = row["alert_sig"] or ""
        prev_sig, prev_ts = _split_alert_sig(raw)
        if raw == sig:
            prev_sig = sig
        now_ts = int(datetime.now(timezone.utc).timestamp())
        if cooldown_sec is not None:
            if prev_sig == sig:
                if not prev_ts:
                    # старый plain — зафиксировать время, не спамить сразу
                    _c().execute(
                        "UPDATE applicants SET alert_sig=?, updated_at=? WHERE tg_id=?",
                        (f"{sig}|{now_ts}", now(), tg_id),
                    )
                    _c().commit()
                    return False
                if (now_ts - prev_ts) < cooldown_sec:
                    return False
            store = f"{sig}|{now_ts}"
        else:
            if prev_sig == sig or raw == sig:
                return False
            store = sig
        _c().execute(
            "UPDATE applicants SET alert_sig=?, updated_at=? WHERE tg_id=?",
            (store, now(), tg_id),
        )
        _c().commit()
        return True


def list_applicants(steps: tuple[str, ...] | None = None) -> list[sqlite3.Row]:
    if steps:
        marks = ",".join("?" for _ in steps)
        return list(
            _c().execute(
                f"SELECT * FROM applicants WHERE step IN ({marks}) ORDER BY updated_at DESC",
                steps,
            ).fetchall()
        )
    return list(
        _c().execute("SELECT * FROM applicants ORDER BY updated_at DESC").fetchall()
    )


def find_applicants(query: str, limit: int = 24) -> list[sqlite3.Row]:
    """Поиск по нику / имени / @username (подстрока, без регистра)."""
    q = (query or "").strip()
    if len(q) < 1:
        return []
    like = f"%{q}%"
    prefix = f"{q}%"
    return list(
        _c()
        .execute(
            """
            SELECT * FROM applicants
            WHERE game_nick LIKE ? COLLATE NOCASE
               OR IFNULL(real_name, '') LIKE ? COLLATE NOCASE
               OR IFNULL(tg_username, '') LIKE ? COLLATE NOCASE
            ORDER BY
              CASE WHEN game_nick LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
              game_nick COLLATE NOCASE
            LIMIT ?
            """,
            (like, like, like, prefix, limit),
        )
        .fetchall()
    )


def label(row: sqlite3.Row) -> str:
    nick = row["game_nick"] or "без ника"
    name = row["real_name"] or ""
    if name:
        return f"{nick} ({name})"
    return nick


def export_csv() -> tuple[bytes, bytes]:
    people = list_applicants()
    buf_p = io.StringIO()
    w = csv.writer(buf_p)
    w.writerow(
        [
            "tg_id",
            "tg_username",
            "game_nick",
            "real_name",
            "steam_id",
            "step",
            "site_user_id",
            "created_at",
            "updated_at",
            "accepted_at",
        ]
    )
    for r in people:
        w.writerow(
            [
                r["tg_id"],
                r["tg_username"] or "",
                r["game_nick"] or "",
                r["real_name"] or "",
                r["steam_id"] or "",
                r["step"],
                r["site_user_id"] or "",
                r["created_at"],
                r["updated_at"],
                r["accepted_at"] or "",
            ]
        )
    ev = list(_c().execute("SELECT * FROM events ORDER BY id").fetchall())
    buf_e = io.StringIO()
    w = csv.writer(buf_e)
    w.writerow(["id", "at", "tg_id", "kind", "detail"])
    for r in ev:
        w.writerow([r["id"], r["at"], r["tg_id"] or "", r["kind"], r["detail"] or ""])
    return (
        buf_p.getvalue().encode("utf-8-sig"),
        buf_e.getvalue().encode("utf-8-sig"),
    )

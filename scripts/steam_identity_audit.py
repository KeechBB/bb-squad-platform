#!/usr/bin/env python3
"""
Phase 1 dry-run: find Steam IDs with multiple nicks that split site stats.

Read-only. Writes JSON/MD report under scripts/_audit_out/ (or --out).

Sources:
  - SquadRoleEvent (TR% / TPUB%) nickAtSpawn ↔ steamId
  - data/public/rp-ladder.json leaderboard rows by nick
  - data/public or train ladder if present
  - User table (registered on site)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/var/www/bb-squad-platform")
NICK_RE = re.compile(r"\s+")


def nick_key(n: str) -> str:
    return NICK_RE.sub("", str(n or "").strip().lower())


def load_env_db() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("DATABASE_URL missing")


def psql(url: str, sql: str) -> list[list[str]]:
    out = subprocess.check_output(
        ["psql", url, "-At", "-F", "\t", "-c", sql],
        text=True,
        errors="replace",
    )
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        rows.append(line.split("\t"))
    return rows


def load_ladder_nicks(path: Path) -> dict[str, dict]:
    """nickKey -> {nick, rp, place, matches}"""
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    board = data.get("leaderboard") or []
    players = data.get("players") or {}
    out: dict[str, dict] = {}
    for i, row in enumerate(board):
        nick = str(row.get("nick") or "")
        k = nick_key(nick)
        if not k:
            continue
        p = players.get(k) if isinstance(players, dict) else None
        matches = []
        if isinstance(p, dict):
            matches = p.get("matches") or []
        out[k] = {
            "nick": nick,
            "rp": float(row.get("rp") or 0),
            "place": int(row.get("place") or i + 1),
            "matches": len(matches) if isinstance(matches, list) else 0,
            "rankLabel": row.get("rankLabel"),
        }
    return out


@dataclass
class SteamCluster:
    steam_id: str
    nicks: dict[str, dict] = field(default_factory=dict)  # nickKey -> meta
    user_nick: str | None = None
    user_name: str | None = None
    profile_complete: bool | None = None

    def add_log_nick(self, nick: str, server_group: str, events: int, first_d: str, last_d: str):
        k = nick_key(nick)
        if not k:
            return
        slot = self.nicks.setdefault(
            k,
            {
                "nick": nick.strip(),
                "log": {},  # group -> {n, first, last}
                "public": None,
                "train": None,
            },
        )
        # prefer longer/display form
        if len(nick.strip()) > len(str(slot["nick"])):
            slot["nick"] = nick.strip()
        slot["log"][server_group] = {
            "events": events,
            "first": first_d,
            "last": last_d,
        }

    @property
    def distinct_log_nicks(self) -> int:
        return len(self.nicks)

    @property
    def public_rows(self) -> list[dict]:
        return [v["public"] for v in self.nicks.values() if v.get("public")]

    @property
    def train_rows(self) -> list[dict]:
        return [v["train"] for v in self.nicks.values() if v.get("train")]

    @property
    def split_public(self) -> bool:
        return len(self.public_rows) >= 2

    @property
    def split_train(self) -> bool:
        return len(self.train_rows) >= 2

    @property
    def multi_nick(self) -> bool:
        return self.distinct_log_nicks >= 2

    def severity(self) -> int:
        # higher = more urgent
        s = 0
        if self.split_public:
            s += 100 + sum(r["matches"] for r in self.public_rows)
        if self.split_train:
            s += 50 + sum(r["matches"] for r in self.train_rows)
        if self.multi_nick and (self.public_rows or self.train_rows):
            s += 10 * self.distinct_log_nicks
        if self.user_nick and nick_key(self.user_nick) not in self.nicks:
            # registered nick not seen in logs under same key — still ok
            s += 1
        return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=str(ROOT / "scripts" / "_audit_out"),
        help="output directory",
    )
    ap.add_argument("--min-events", type=int, default=3, help="min log events per nick")
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    url = load_env_db()
    print("loading role events…")
    # Aggregate nick↔steam for public and train servers
    sql = f"""
SELECT
  "steamId",
  coalesce("nickAtSpawn",''),
  CASE
    WHEN "serverKey" LIKE 'TPUB%' THEN 'TPUB'
    WHEN "serverKey" LIKE 'TR%' THEN 'TR'
    ELSE 'OTHER'
  END AS grp,
  count(*)::int AS n,
  min(("spawnedAt" AT TIME ZONE 'Europe/Moscow')::date)::text AS first_d,
  max(("spawnedAt" AT TIME ZONE 'Europe/Moscow')::date)::text AS last_d
FROM "SquadRoleEvent"
WHERE "steamId" IS NOT NULL
  AND length("steamId") >= 10
  AND coalesce("nickAtSpawn",'') <> ''
  AND ("serverKey" LIKE 'TPUB%' OR "serverKey" LIKE 'TR%')
GROUP BY 1, 2, 3
HAVING count(*) >= {int(args.min_events)}
ORDER BY 1, 4 DESC;
"""
    rows = psql(url, sql)
    print(f"log aggregate rows: {len(rows)}")

    clusters: dict[str, SteamCluster] = {}
    for steam, nick, grp, n, first_d, last_d in rows:
        c = clusters.get(steam)
        if not c:
            c = SteamCluster(steam_id=steam)
            clusters[steam] = c
        c.add_log_nick(nick, grp, int(n), first_d, last_d)

    print("loading users…")
    for r in psql(
        url,
        """
SELECT "steamId", coalesce(nick,''), coalesce(name,''), "profileComplete"::text
FROM "User"
WHERE "steamId" IS NOT NULL AND length("steamId") >= 10;
""",
    ):
        steam, nick, name, pc = r
        c = clusters.get(steam)
        if not c:
            c = SteamCluster(steam_id=steam)
            clusters[steam] = c
        c.user_nick = nick or None
        c.user_name = name or None
        c.profile_complete = pc in ("t", "true", "TRUE", "1")
        if nick:
            c.add_log_nick(nick, "USER", 0, "", "")

    print("loading ladders…")
    pub = load_ladder_nicks(ROOT / "data/public/rp-ladder.json")
    train_paths = [
        ROOT / "data/train/rp-ladder.json",
        ROOT / "data/training/rp-ladder.json",
        ROOT / "data/public/train-rp-ladder.json",
        ROOT / "data/kv-cache/data/training/rp-ladder.json",
    ]
    train: dict[str, dict] = {}
    for p in train_paths:
        train = load_ladder_nicks(p)
        if train:
            print(f"train ladder: {p} ({len(train)})")
            break
    if not train:
        print("train ladder: not found (skip)")

    # nickKey -> steams that used this exact key in logs
    nick_to_steams: dict[str, set[str]] = defaultdict(set)
    for steam, c in clusters.items():
        for k in c.nicks:
            nick_to_steams[k].add(steam)

    def attach_exact(ladder: dict[str, dict], field: str) -> None:
        for k, row in ladder.items():
            steams = nick_to_steams.get(k) or set()
            if len(steams) != 1:
                continue
            sid = next(iter(steams))
            c = clusters[sid]
            slot = c.nicks.setdefault(
                k, {"nick": row["nick"], "log": {}, "public": None, "train": None}
            )
            if len(row["nick"]) > len(str(slot["nick"])):
                slot["nick"] = row["nick"]
            slot[field] = row

    def attach_fuzzy_for_multi(ladder: dict[str, dict], field: str) -> None:
        """For steams already multi-nick, pull extra ladder rows with substring nick match."""
        candidates = [c for c in clusters.values() if len(c.nicks) >= 2]
        for c in candidates:
            keys = [k for k in c.nicks.keys() if len(k) >= 5]
            if not keys:
                continue
            already = {
                k for k, slot in c.nicks.items() if slot.get(field) is not None
            }
            for k, row in ladder.items():
                if k in already or k in c.nicks and c.nicks[k].get(field):
                    continue
                # unique enough: matches this steam's key, not another steam exact
                exact_owners = nick_to_steams.get(k) or set()
                if exact_owners and exact_owners != {c.steam_id}:
                    continue
                hit = False
                for lk in keys:
                    if lk in k or (len(k) >= 5 and k in lk):
                        hit = True
                        break
                if not hit:
                    continue
                slot = c.nicks.setdefault(
                    k, {"nick": row["nick"], "log": {}, "public": None, "train": None}
                )
                if len(row["nick"]) > len(str(slot["nick"])):
                    slot["nick"] = row["nick"]
                if slot.get(field) is None:
                    slot[field] = row

    attach_exact(pub, "public")
    attach_exact(train, "train")
    attach_fuzzy_for_multi(pub, "public")
    attach_fuzzy_for_multi(train, "train")

    multi = [c for c in clusters.values() if c.multi_nick]
    split_pub = [c for c in multi if c.split_public]
    split_tr = [c for c in multi if c.split_train]
    registered_split = [
        c for c in multi if c.profile_complete and (c.split_public or c.split_train)
    ]

    multi.sort(key=lambda c: (-c.severity(), -c.distinct_log_nicks, c.steam_id))
    split_pub.sort(key=lambda c: -c.severity())

    def cluster_dict(c: SteamCluster) -> dict:
        return {
            "steamId": c.steam_id,
            "userNick": c.user_nick,
            "userName": c.user_name,
            "profileComplete": c.profile_complete,
            "nickCount": c.distinct_log_nicks,
            "splitPublic": c.split_public,
            "splitTrain": c.split_train,
            "severity": c.severity(),
            "publicRpSum": round(sum(r["rp"] for r in c.public_rows), 1),
            "publicPlaces": [r["place"] for r in c.public_rows],
            "publicMatchesSum": sum(r["matches"] for r in c.public_rows),
            "nicks": [
                {
                    "nick": slot["nick"],
                    "nickKey": k,
                    "log": slot["log"],
                    "public": slot.get("public"),
                    "train": slot.get("train"),
                }
                for k, slot in sorted(
                    c.nicks.items(), key=lambda kv: -(kv[1].get("public") or {}).get("matches", 0)
                )
            ],
        }

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "root": str(ROOT),
        "totals": {
            "steamsSeen": len(clusters),
            "multiNickSteams": len(multi),
            "splitPublic": len(split_pub),
            "splitTrain": len(split_tr),
            "registeredWithSplit": len(registered_split),
            "publicLadderRows": len(pub),
            "trainLadderRows": len(train),
        },
        "topSplitPublic": [cluster_dict(c) for c in split_pub[:80]],
        "topMultiNick": [cluster_dict(c) for c in multi[:120]],
        "registeredSplit": [cluster_dict(c) for c in registered_split[:80]],
    }

    json_path = out_dir / "steam-identity-audit.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown summary
    lines = [
        f"# Steam identity audit",
        f"",
        f"Generated: `{report['generatedAt']}`",
        f"",
        f"- Steams in logs/users: **{report['totals']['steamsSeen']}**",
        f"- Steams with ≥2 nicks: **{report['totals']['multiNickSteams']}**",
        f"- Split **public** ladder (≥2 rows): **{report['totals']['splitPublic']}**",
        f"- Split **train** ladder (≥2 rows): **{report['totals']['splitTrain']}**",
        f"- Registered on site with split: **{report['totals']['registeredWithSplit']}**",
        f"",
        f"## Top public splits (pilot candidates)",
        f"",
        f"| Steam | Site nick | Nicks | Public places | Public RP sum | Matches |",
        f"|---|---|---|---|---|---|",
    ]
    for c in split_pub[:40]:
        nicks = ", ".join(slot["nick"] for slot in cluster_dict(c)["nicks"] if slot.get("public"))
        if not nicks:
            nicks = ", ".join(slot["nick"] for slot in list(cluster_dict(c)["nicks"])[:4])
        d = cluster_dict(c)
        lines.append(
            f"| `{c.steam_id}` | {c.user_nick or '—'} | {nicks} | "
            f"{', '.join(str(p) for p in d['publicPlaces'])} | {d['publicRpSum']} | {d['publicMatchesSum']} |"
        )

    lines += [
        f"",
        f"## Registered users with any split",
        f"",
    ]
    if not registered_split:
        lines.append("_none_")
    else:
        lines += [
            f"| Steam | Site nick | Name | Public split | Train split | Nicks |",
            f"|---|---|---|---|---|---|",
        ]
        for c in registered_split[:40]:
            d = cluster_dict(c)
            nick_list = ", ".join(x["nick"] for x in d["nicks"][:6])
            lines.append(
                f"| `{c.steam_id}` | {c.user_nick or '—'} | {c.user_name or '—'} | "
                f"{'yes' if c.split_public else 'no'} | {'yes' if c.split_train else 'no'} | {nick_list} |"
            )

    md_path = out_dir / "steam-identity-audit.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("wrote", json_path)
    print("wrote", md_path)
    print("totals", json.dumps(report["totals"], ensure_ascii=False))
    print("\nTOP 15 public splits:")
    for c in split_pub[:15]:
        d = cluster_dict(c)
        pubs = [
            f"{x['nick']}@#{x['public']['place']}({x['public']['rp']})"
            for x in d["nicks"]
            if x.get("public")
        ]
        print(f"  {c.steam_id} site={c.user_nick!r} :: {' | '.join(pubs)}")


if __name__ == "__main__":
    main()

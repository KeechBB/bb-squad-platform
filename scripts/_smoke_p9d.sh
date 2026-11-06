#!/bin/bash
set -euo pipefail
cd /var/www/bb-squad-platform
git fetch origin
git checkout -f origin/main -- scripts/canon_verify_match.py scripts/canon_fill_public_players.py
python3 <<'PY'
import sys
sys.path.insert(0, "scripts")
import canon_verify_match as V
import canon_fill_public_players as F
from collections import Counter

key = "2026-10-25_pb1_yehorivkaraasv2_2255"
m = V.fetch_match(match_key=key)
slices = V.find_slice_dirs(key, day="2026-10-25", server="pb1")
print("best", slices[0].name if slices else None)
print("all", [s.name for s in slices[:5]])
if slices:
    rows = F.roster_from_slice(slices[0])
    print("roster", len(rows), dict(Counter(r["side"] for r in rows)))
if m:
    print("filled_one", F.fill_match(m, force=True))

n = pl = 0
for row in F.list_public(40, needing_only=False):
    k = F.fill_match(row, force=True)
    if k:
        n += 1
        pl += k
        print("+", row["matchKey"], k, flush=True)
print("done", n, pl)

import canon_match_write as C
import psycopg2

conn = psycopg2.connect(C.load_env_db())
cur = conn.cursor()
cur.execute(
    '''
    SELECT count(DISTINCT p."matchId")
    FROM "CanonMatchPlayer" p
    JOIN "CanonMatch" m ON m.id = p."matchId"
    WHERE m.kind = %s
    ''',
    ("PUBLIC",),
)
print("public_with_players", cur.fetchone()[0])
cur.execute(
    '''
    SELECT m."matchKey", count(p.id),
           count(*) FILTER (WHERE p.side='U'),
           count(*) FILTER (WHERE p.side IN ('A','B'))
    FROM "CanonMatch" m
    JOIN "CanonMatchPlayer" p ON p."matchId" = m.id
    WHERE m.kind = %s
    GROUP BY m."matchKey", m."endedAt"
    ORDER BY m."endedAt" DESC NULLS LAST
    LIMIT 5
    ''',
    ("PUBLIC",),
)
print("recent:")
for r in cur.fetchall():
    print(f"  {r[0]} n={r[1]} U={r[2]} AB={r[3]}")
conn.close()
PY

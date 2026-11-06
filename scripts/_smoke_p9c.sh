#!/bin/bash
set -euo pipefail
cd /var/www/bb-squad-platform
cp /var/www/bb-squad-platform/scripts/canon_fill_public_players.py /tmp/cfp.py.bak 2>/dev/null || true
# file already scp'd; also sync from git
git fetch origin
git checkout -f origin/main -- scripts/canon_fill_public_players.py || true
python3 <<'PY'
import sys
sys.path.insert(0, "scripts")
import canon_verify_match as V
import canon_fill_public_players as F
key = "2026-10-25_pb1_yehorivkaraasv2_2255"
m = V.fetch_match(match_key=key)
print("match", bool(m), m.get("id") if m else None)
slices = V.find_slice_dirs(
    key,
    day="2026-10-25",
    server=(m or {}).get("serverKey") or "pb1",
    map_name=(m or {}).get("mapName"),
)
print("slices", [str(s) for s in slices[:3]])
if slices:
    rows = F.roster_from_slice(slices[0])
    from collections import Counter
    print("roster_n", len(rows), dict(Counter(r["side"] for r in rows)))
if m:
    n = F.fill_match(m, force=True)
    print("filled", n)
PY
python3 <<'PY'
import sys
sys.path.insert(0, "scripts")
import canon_match_write as C, psycopg2
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
    JOIN "CanonMatchPlayer" p ON p."matchId"=m.id
    WHERE m.kind=%s AND m."matchKey"=%s
    GROUP BY m."matchKey"
    ''',
    ("PUBLIC", "2026-10-25_pb1_yehorivkaraasv2_2255"),
)
print("sample", cur.fetchone())
conn.close()
PY

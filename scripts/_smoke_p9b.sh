#!/bin/bash
set -euo pipefail
cd /var/www/bb-squad-platform
git fetch origin
git checkout -f origin/main -- scripts/canon_fill_public_players.py
# quiet-ish: force-refill recent public (complete U+A/B roster)
python3 scripts/canon_fill_public_players.py --limit 40 --force 2>/dev/null
python3 <<'PY'
import sys
sys.path.insert(0, "scripts")
import canon_match_write as C
import psycopg2

conn = psycopg2.connect(C.load_env_db())
cur = conn.cursor()
cur.execute('SELECT count(*) FROM "CanonMatch" WHERE kind = %s', ("PUBLIC",))
print("public_matches", cur.fetchone()[0])
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
    SELECT m."matchKey", count(p.id) AS n,
           count(*) FILTER (WHERE p.side = 'U') AS u,
           count(*) FILTER (WHERE p.side IN ('A','B')) AS ab
    FROM "CanonMatch" m
    JOIN "CanonMatchPlayer" p ON p."matchId" = m.id
    WHERE m.kind = %s
    GROUP BY m."matchKey"
    ORDER BY m."endedAt" DESC NULLS LAST
    LIMIT 5
    ''',
    ("PUBLIC",),
)
print("recent:")
for row in cur.fetchall():
    print(f"  {row[0]} players={row[1]} U={row[2]} AB={row[3]}")
conn.close()
PY

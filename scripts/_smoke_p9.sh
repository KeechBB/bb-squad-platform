#!/bin/bash
set -euo pipefail
cd /var/www/bb-squad-platform
git fetch origin
git checkout -f origin/main -- \
  scripts/canon_fill_public_players.py \
  scripts/siphon_slice_matches.py \
  docs/PHASE9-PUBLIC-PLAYERS.md \
  docs/CHANGELOG.md
python3 scripts/canon_fill_public_players.py --limit 60
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
    SELECT m."matchKey", count(p.id) AS n
    FROM "CanonMatch" m
    JOIN "CanonMatchPlayer" p ON p."matchId" = m.id
    WHERE m.kind = %s
    GROUP BY m."matchKey"
    ORDER BY n DESC
    LIMIT 5
    ''',
    ("PUBLIC",),
)
print("top:")
for row in cur.fetchall():
    print(" ", row[0], "players=", row[1])
conn.close()
PY

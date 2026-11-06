#!/bin/bash
set -euo pipefail
cd /var/www/bb-squad-platform
git fetch origin
git checkout -B main origin/main

npx prisma generate
npx prisma db push --skip-generate

python3 scripts/rp_ladder_db.py --all

python3 <<'PY'
import sys
sys.path.insert(0, "scripts")
import canon_match_write as C
import psycopg2
conn = psycopg2.connect(C.load_env_db())
cur = conn.cursor()
for scope in ("TRAIN", "PUBLIC"):
    cur.execute('SELECT count(*) FROM "RpLadderPlayer" WHERE scope=%s::"RpScope"', (scope,))
    n = cur.fetchone()[0]
    cur.execute('SELECT count(*) FROM "RpScoredMatch" WHERE scope=%s::"RpScope"', (scope,))
    m = cur.fetchone()[0]
    cur.execute('SELECT "updatedAt", epoch FROM "RpMeta" WHERE scope=%s::"RpScope"', (scope,))
    meta = cur.fetchone()
    print(f"{scope}: players={n} matches={m} meta={meta}")
cur.execute(
    '''SELECT nick, rp, "rankLabel" FROM "RpLadderPlayer"
       WHERE scope=%s::"RpScope" ORDER BY place NULLS LAST, rp DESC LIMIT 5''',
    ("PUBLIC",),
)
print("PUBLIC top:")
for r in cur.fetchall():
    print(" ", r)
conn.close()
PY

BB_DEPLOY_FORCE_CLEAN=1 bash scripts/deploy.sh

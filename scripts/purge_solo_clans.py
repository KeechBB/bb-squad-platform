#!/usr/bin/env python3
"""Delete a live clan that has had exactly one member for more than 7 days.

External opponent cards and BlackBerry are never removed.
soloSince is the moment the clan became a one-player clan.
"""
import subprocess
import sys

SQL = r"""
ALTER TABLE "Clan" ADD COLUMN IF NOT EXISTS "soloSince" TIMESTAMP(3);

-- Второй игрок появился — срок соло больше не идёт.
UPDATE "Clan" c
SET "soloSince" = NULL
WHERE c."soloSince" IS NOT NULL
  AND (SELECT count(*) FROM "ClanMember" m WHERE m."clanId" = c.id) >= 2;

-- Уже соло с создания: единственный участник вступил вместе с кланом.
UPDATE "Clan" c
SET "soloSince" = c."createdAt"
WHERE c."isExternal" = false
  AND c."soloSince" IS NULL
  AND (SELECT count(*) FROM "ClanMember" m WHERE m."clanId" = c.id) = 1
  AND (SELECT max(m."joinedAt") FROM "ClanMember" m WHERE m."clanId" = c.id)
      <= c."createdAt" + interval '2 minutes';

-- Стал соло позже, момент неизвестен — отсчёт с этого прохода.
UPDATE "Clan" c
SET "soloSince" = now()
WHERE c."isExternal" = false
  AND c."soloSince" IS NULL
  AND (SELECT count(*) FROM "ClanMember" m WHERE m."clanId" = c.id) = 1;

CREATE TEMP TABLE doomed AS
SELECT c.id, c.tag, c.name
FROM "Clan" c
WHERE c."isExternal" = false
  AND c.tag <> 'BB'
  AND c.name NOT ILIKE 'blackberry'
  AND (SELECT count(*) FROM "ClanMember" m WHERE m."clanId" = c.id) = 1
  AND c."soloSince" IS NOT NULL
  AND c."soloSince" < now() - interval '7 days';

INSERT INTO "ActionLog" (id, "createdAt", category, action, message, "searchText", "clanTag")
SELECT
  substr(md5(random()::text || d.id), 1, 25),
  now(),
  'clan',
  'disband',
  'Клан [' || d.tag || '] ' || d.name || ' снят: один участник больше недели',
  lower('клан [' || d.tag || '] ' || d.name || ' снят: один участник больше недели'),
  d.tag
FROM doomed d;

DELETE FROM "Clan" c
USING doomed d
WHERE c.id = d.id;

SELECT tag, name FROM doomed ORDER BY tag;
"""


def main() -> int:
    proc = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", "bb_squad", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=SQL,
        text=True,
        check=False,
    )
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())

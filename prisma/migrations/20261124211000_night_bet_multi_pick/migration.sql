-- Несколько ставок с одной стороны на разные фракции; отмена/возврат запрещены.
DROP INDEX IF EXISTS "FactionNightBet_window_faction_unique";
DROP INDEX IF EXISTS "FactionNightBet_window_personal_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "FactionNightBet_window_faction_pick_unique"
  ON "FactionNightBet" ("windowId", "fromFactionId", "pickFactionId")
  WHERE "fromFactionId" IS NOT NULL AND "isPersonal" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "FactionNightBet_window_personal_pick_unique"
  ON "FactionNightBet" ("windowId", "placedByUserId", "pickFactionId")
  WHERE "isPersonal" = true;

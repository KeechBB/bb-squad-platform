-- AlterTable: личные ставки Keech
ALTER TABLE "FactionNightBet" ADD COLUMN IF NOT EXISTS "isPersonal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FactionNightBet" ALTER COLUMN "fromFactionId" DROP NOT NULL;

ALTER TABLE "FactionNightBet" DROP CONSTRAINT IF EXISTS "FactionNightBet_windowId_fromFactionId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "FactionNightBet_window_faction_unique"
  ON "FactionNightBet" ("windowId", "fromFactionId")
  WHERE "fromFactionId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "FactionNightBet_window_personal_unique"
  ON "FactionNightBet" ("windowId", "placedByUserId")
  WHERE "isPersonal" = true;

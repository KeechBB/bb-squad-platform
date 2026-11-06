-- Срез «Отчет по BB». Сайт читает только вью.
CREATE TABLE IF NOT EXISTS "BbTrainReport" (
  id text PRIMARY KEY,
  "reportDate" date NOT NULL,
  slot text NOT NULL,
  "takenAt" timestamp(3) without time zone NOT NULL,
  "peakOnline" integer NOT NULL,
  "joinedTotal" integer NOT NULL,
  "ydayMissingN" integer NOT NULL,
  "weekMissingN" integer NOT NULL,
  "schedExpected" integer NOT NULL,
  "schedPresent" integer NOT NULL,
  "lateFirstN" integer NOT NULL,
  payload jsonb NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BbTrainReport_reportDate_slot_key" UNIQUE ("reportDate", slot)
);

CREATE INDEX IF NOT EXISTS "BbTrainReport_reportDate_idx"
  ON "BbTrainReport" ("reportDate");

CREATE OR REPLACE VIEW "BbTrainReportV" AS
SELECT
  id,
  "reportDate",
  slot,
  "takenAt",
  "peakOnline",
  "joinedTotal",
  "ydayMissingN",
  "weekMissingN",
  "schedExpected",
  "schedPresent",
  "lateFirstN",
  payload,
  "createdAt",
  "updatedAt"
FROM "BbTrainReport";

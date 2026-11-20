/**
 * Ручной / cron запуск аудита стоимости фракций.
 *   npx tsx scripts/audit_faction_player_values.ts
 *   npx tsx scripts/audit_faction_player_values.ts --no-tg
 */
import { auditFactionPlayerValues } from "../src/lib/playerValueAudit";

async function main() {
  const noTg = process.argv.includes("--no-tg");
  const report = await auditFactionPlayerValues({
    sendTelegram: !noTg,
    matchLabel: "manual",
  });
  console.log(report.text);
  console.log(
    JSON.stringify(
      {
        total: report.total,
        ok: report.ok,
        errors: report.errors,
        fixed: report.fixed,
        issueNicks: report.issues.map((i) => i.nick),
      },
      null,
      2
    )
  );
  if (report.errors > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

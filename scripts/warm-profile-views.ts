/**
 * Отдельный процесс: переписывает несколько готовых файлов профиля.
 *   npx tsx scripts/warm-profile-views.ts 3
 * Запрос страницы этот пересчёт не ждёт.
 */
import { prisma } from "../src/lib/prisma";
import { warmNextProfileViews } from "../src/lib/profileViewSnapshot";

async function main() {
  const limit = Number(process.argv[2] || 3);
  const done = await warmNextProfileViews(
    Number.isFinite(limit) && limit > 0 ? limit : 3
  );
  console.log(done.length ? done.join(", ") : "none");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

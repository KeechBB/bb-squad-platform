import { prisma } from "@/lib/prisma";

const HIDDEN_KIND = "hidden";
const HIDDEN_LABEL = "Скрытый источник";
const RACE_KIND = "faction_race";
const RACE_LABEL = "Гонка фракций";

async function keechAuthorId(): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true },
  });
  if (u) return u.id;
  const byNick = await prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { id: true },
  });
  return byNick?.id || null;
}

export async function sendRaceMail(opts: {
  toUserIds: string[];
  title: string;
  body: string;
  sourceKey: string;
  hidden?: boolean;
  tags?: string[];
}): Promise<string | null> {
  const authorId = await keechAuthorId();
  const ids = [...new Set(opts.toUserIds.filter(Boolean))];
  if (!authorId || !ids.length) return null;
  try {
    const mail = await prisma.profileMail.create({
      data: {
        title: opts.title,
        body: opts.body,
        senderKind: opts.hidden ? HIDDEN_KIND : RACE_KIND,
        senderLabel: opts.hidden ? HIDDEN_LABEL : RACE_LABEL,
        tags: opts.tags?.length ? opts.tags : ["Гонка фракций"],
        sourceKey: opts.sourceKey,
        authorId,
        recipients: { create: ids.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return mail.id;
  } catch (e) {
    // unique sourceKey — уже слали
    console.error("race mail failed", e);
    return null;
  }
}

function fmtGoal(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

export function day1Body(factionName: string, goal: number, windowLabel: string): string {
  return [
    `Фракция «${factionName}».`,
    ``,
    `На неделю ${windowLabel} вам нужно набрать ${fmtGoal(goal)} Черничных долларов гринда в казну.`,
    ``,
    `Если план не будет выполнен к концу окна — вы потеряете одного участника фракции случайным образом.`,
    `Избежать потери можно только успешным трансфером игрока из состава в отведённые 24 часа после дедлайна.`,
    ``,
    `Легион в этой системе не участвует. Резерв, оформленный до закрытия окна, защищён.`,
  ].join("\n");
}

const MID_ON_PACE = [
  (f: string, left: string, pct: number) =>
    `«${f}», вы держите темп. Сейчас ~${pct}% плана, до дедлайна ${left}. Не сбавляйте — товарищ в ростере считает на вас.`,
  (f: string, left: string, pct: number) =>
    `Скрытая сводка по «${f}»: динамика хорошая (${pct}%). Осталось ${left}. Дожмите гринд — и неделя ваша.`,
  (f: string, left: string, pct: number) =>
    `«${f}» идёт в графике (${pct}% цели). ${left} до отсечки. Спокойный контроль лучше паники в последний вечер.`,
];

const MID_BEHIND = [
  (f: string, left: string, pct: number) =>
    `«${f}»: вы отстаёте. Всего ${pct}% плана, до дедлайна ${left}. Без рывка к концу недели сработает случайный штраф.`,
  (f: string, left: string, pct: number) =>
    `Тревожный сигнал по «${f}». Прогресс ${pct}%. ${left} — и либо казна, либо потеря человека. Решайте сейчас.`,
  (f: string, left: string, pct: number) =>
    `«${f}» ниже прогноза (${pct}%). Осталось ${left}. Командирам: либо гринд, либо готовьте самостоятельный трансфер на grace.`,
];

export function midBody(opts: {
  factionName: string;
  onPace: boolean;
  pct: number;
  leftLabel: string;
  salt: number;
}): string {
  const pool = opts.onPace ? MID_ON_PACE : MID_BEHIND;
  const fn = pool[Math.abs(opts.salt) % pool.length]!;
  return fn(opts.factionName, opts.leftLabel, opts.pct);
}

export function finalMetBody(factionName: string, amount: number, goal: number, nextGoal: number): string {
  return [
    `Фракция «${factionName}» выполнила план недели.`,
    ``,
    `Набрано ${fmtGoal(amount)} из ${fmtGoal(goal)} B$.`,
    `Выполнив план, вы спасли товарища: принудительный штраф этой недели вам не грозит.`,
    ``,
    `Следующая личная цель: ${fmtGoal(nextGoal)} B$ (+5%).`,
  ].join("\n");
}

export function finalFailBody(
  factionName: string,
  amount: number,
  goal: number,
  nextGoal: number,
): string {
  return [
    `Фракция «${factionName}» не выполнила план недели.`,
    ``,
    `Набрано ${fmtGoal(amount)} из ${fmtGoal(goal)} B$.`,
    `Запускается 24 часа на самостоятельный трансфер. Если за это время из состава никто не уйдёт сделкой — система случайно исключит одного участника (не главу и не зама), сделает его свободным агентом и распределит через СРИ в другую фракцию.`,
    ``,
    `Следующая личная цель: ${fmtGoal(nextGoal)} B$ (−5%). Гонка новой недели уже идёт.`,
  ].join("\n");
}

export function exemptBody(factionName: string, playerNick: string): string {
  return [
    `Фракция «${factionName}»: самостоятельный трансфер спас вас от автоштрафа.`,
    ``,
    `${playerNick} ушёл из состава сделкой в отведённые 24 часа. Принудительное исключение отменено.`,
    `План по гриндам этой недели при этом считается по факту набора — цель следующей недели уже пересчитана (±5%).`,
  ].join("\n");
}

export function lostComradeBody(factionName: string, playerNick: string): string {
  return [
    `Фракция «${factionName}» потеряла товарища.`,
    ``,
    `${playerNick} исключён системой гонки фракций: план недели не выполнен, самостоятельный трансфер за 24 часа не состоялся.`,
    `Почему и за что: не набран недельный гринд казны, командиры не закрыли исходящий трансфер в grace-окне.`,
  ].join("\n");
}

export function victimKickBody(factionName: string): string {
  return [
    `Вас исключили из фракции «${factionName}».`,
    ``,
    `Почему и за что: фракция не выполнила недельный план гонки (гринд казны), и за 24 часа после дедлайна не был сделан самостоятельный трансфер. Система выбрала участника случайно (глава и зам вне пула).`,
    `Вам назначена роль свободного агента. СРИ распределит вас в другую фракцию. Вернуться в «${factionName}» через СРИ нельзя — только обычным трансфером.`,
  ].join("\n");
}

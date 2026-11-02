import { prisma } from "@/lib/prisma";
import type { SupportTopicId } from "@/lib/support";

const AGENTS = [
  "Капрал Харджу",
  "Док Мутаха",
  "Сержант Городок",
  "Радист Нарва",
  "Сапёр Фаллуджа",
  "Наводчик Кохат",
  "Механик Чора",
  "Стрелок Камоз",
  "Медик Басра",
  "Пулемётчик Белль",
  "Разведчик Манич",
  "Связист Талль",
  "Командир отделения Лог",
  "Гранатомётчик Ехори",
  "Инженер Сквад",
];

/** Отдельное сообщение после ответа: ждём да/нет. */
export const SUPPORT_HELP_CHECK = "Помог ли я вам с этим вопросом?";

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

export function pickSupportAgentName(): string {
  return pick(AGENTS);
}

export function supportIntro(topic: SupportTopicId, name: string): string {
  if (topic === "suggestion") {
    return pick([
      `${name} на связи. Есть идея, как сделать клан крепче — пиши. Я приму текст и передам по команде.`,
      `${name}, пост техподдержки. Предложения читаем. Опиши, что поменять и зачем: чем конкретнее, тем быстрее разберём.`,
      `${name} слушает. Рация открыта под идеи. Напиши, что на сайте или в клане стоит поправить.`,
    ]);
  }
  if (topic === "bug") {
    return pick([
      `${name} на проводе. Если что-то сломалось — это ко мне. Напиши, где нажал и что увидел вместо нормального.`,
      `${name}. Баг — это когда карта врёт. Страница, кнопка, что пошло не так. Пиши как есть.`,
      `${name} на посту. Поймал поломку — доложи. Я запишу и позову тех, кто чинит.`,
    ]);
  }
  return pick([
    `${name} на связи. Спрашивай по сайту и клану. Если знаю ответ — скажу сразу. Если нет, позову оператора.`,
    `${name}, техподдержка BlackBerry. Один вопрос — один заход. Разберусь сам или вызову живого.`,
    `${name} у рации. Задавай. Чего нет в уставе сайта, то уйдёт оператору, без выдумок.`,
  ]);
}

function thanksSuggestion(name: string): string {
  return pick([
    `${name}: принял. Идея записана, передам тем, кто собирает сайт. Спасибо, что не промолчал.`,
    `Есть контакт. ${name} отметил предложение. Такие вещи как раз двигают клан вперёд.`,
    `${name} кивает. Прочитал от и до. Текст не уйдёт в песок — его увидит техподдержка.`,
    `${name}, коротко: спасибо. Предложение на столе. Если захочешь добавить деталь — допиши сюда же.`,
  ]);
}

function thanksBug(name: string): string {
  return pick([
    `${name}: вижу. Баг записал как есть. Спасибо, что поймал — без таких докладов мы чиним вслепую.`,
    `${name} ставит метку. Принято, разберём. Если повторится, допиши, на какой странице.`,
    `Доклад принят. ${name} благодарит за глаза: поломку проще закрыть, когда её назвали вслух.`,
    `${name}: есть. Текст у оператора. Ты сделал то, что должен сделать нормальный боец.`,
  ]);
}

function ackMore(name: string): string {
  return pick([
    `${name}: дописал, вижу. Добавил к тому же тикету.`,
    `${name} на связи. Ещё строка легла в журнал, спасибо.`,
    `Принял добавку. ${name} не потеряет её рядом с первым сообщением.`,
  ]);
}

function escalate(name: string, already: boolean): string {
  if (already) {
    return pick([
      `${name}: оператор уже вызван. Допиши деталь, если есть — человек увидит весь тикет.`,
      `${name} держит канал. Живая техподдержка уже в курсе, новое сообщение ей тоже придёт в этот тикет.`,
    ]);
  }
  return pick([
    `${name}: тут я не вижу точного ответа в уставе сайта. Зову оператора — живая техподдержка подключится.`,
    `${name} не будет выдумывать. Вопрос уходит оператору. Человек из поддержки откроет тикет.`,
    `${name}: моих данных не хватает. Вызываю оператора, пусть ответит живой.`,
  ]);
}

function askCloseTicket(name: string): string {
  return pick([
    `${name}: рад, что помог. Закрой тикет кнопкой «Закрыть тикет» внизу окна — так очередь не засоряется.`,
    `${name}: отлично. Нажми «Закрыть тикет» внизу чата, пожалуйста.`,
    `${name}: принято. Если всё ясно — закрой тикет кнопкой внизу.`,
  ]);
}

function askClarify(name: string): string {
  return pick([
    `${name}: понял, ещё не то. Напиши точнее: какую вкладку ищешь или что именно не получается на сайте?`,
    `${name}: ок, копнём глубже. Скажи страницу/кнопку своими словами — попробую ещё раз.`,
    `${name}: принял. Опиши вопрос чуть иначе (раздел меню или что хочешь найти) — отвечу снова.`,
  ]);
}

function norm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

type Faq = {
  hits: (q: string) => number;
  answer: (name: string) => string;
  /** Small-talk: answer only, no «помог?» loop. */
  chitchat?: boolean;
};

const FAQ: Faq[] = [
  {
    hits: (q) =>
      score(q, [
        "как дела",
        "как ты",
        "че как",
        "чё как",
        "как жизнь",
        "как сам",
        "как пожива",
        "how are you",
        "whats up",
        "what s up",
      ]),
    chitchat: true,
    answer: (name) =>
      pick([
        `${name}: в строю, рация чистая. У тебя как? Если по сайту — спрашивай.`,
        `${name}: нормально, на посту. Готов по меню и разделам — кидай вопрос.`,
        `${name}: держусь, спасибо. Чем помочь по сайту или клану?`,
      ]),
  },
  {
    hits: (q) =>
      score(q, [
        "настроен",
        "как настроен",
        "что настроени",
        "всё хорошо",
        "все хорошо",
        "всё ок",
        "все ок",
        "всё норм",
        "все норм",
      ]),
    chitchat: true,
    answer: (name) =>
      pick([
        `${name}: настроение боевое, спасибо. Если всё ок у тебя — можно и тикет закрыть, или спроси по сайту.`,
        `${name}: у меня порядок. Рад слышать. Нужна вкладка или раздел — пиши.`,
        `${name}: держу ровно. Хорошо, что у тебя тоже. Вопрос по меню — я тут.`,
      ]),
  },
  {
    hits: (q) =>
      score(q, ["погод", "на улице", "дождь", "снег", "холодно", "жарко"]),
    chitchat: true,
    answer: (name) =>
      pick([
        `${name}: с рации погоды не видно — на сервере всегда ясно, в Squad смотря какая карта. По сайту могу точнее.`,
        `${name}: прогноз не веду, только навигацию. На Mutaha песок, на Goose Bay зябко — а у тебя что нужно найти?`,
        `${name}: погодой не заведую. Зато знаю, где КВ, ТМ и профиль. Спрашивай.`,
      ]),
  },
  {
    hits: (q) =>
      score(q, [
        "что делаешь",
        "чем занят",
        "ты тут",
        "ты на связи",
        "скучно",
        "кто ты",
        "ты бот",
        "ты человек",
        "живой",
      ]),
    chitchat: true,
    answer: (name) =>
      pick([
        `${name}: на посту техподдержки BlackBerry. Базовые вопросы по сайту закрываю сам, сложное — зову оператора.`,
        `${name}: я помощник на рации, не живой админ. Меню, вкладки, «где что» — ко мне. Если не справлюсь, позову человека.`,
        `${name}: сижу на линии. Скучно не будет, если спросишь про раздел сайта.`,
      ]),
  },
  {
    hits: (q) =>
      score(q, ["спасибо", "благодар", "респект", "красава", "молодец"]),
    chitchat: true,
    answer: (name) =>
      pick([
        `${name}: на связи. Если вопрос закрыт — нажми «Закрыть тикет» внизу.`,
        `${name}: пожалуйста. Можно закрывать тикет кнопкой внизу, если всё ясно.`,
        `${name}: принято. Закрой тикет, когда закончишь — так очередь короче.`,
      ]),
  },
  {
    hits: (q) =>
      score(q, [
        "где вкладк",
        "какие вкладк",
        "навигац",
        "меню сайта",
        "где что",
        "карта сайта",
        "разделы сайта",
        "где найти",
        "где смотреть",
        "куда нажат",
      ]),
    answer: (name) =>
      `${name}: коротко по верхнему меню. «Главная» — анонсы ближайших КВ и топы. «Рейтинг паблика» — публичный RP. «Кланы» → список кланов, «Клановые войны» (/cw) и «Поиск КВ». «Тренировка» → «Тренировочные матчи» (/tm) и «Тренировка стрельбы» (/aim). Дальше «Battle Pass» и «Турниры». Свой профиль — аватар справа вверху (почта, резерв, выходной, стата). Колокольчик — уведомления.`,
  },
  {
    hits: (q) =>
      score(q, ["главн", "домашн", "на главн", "home"]),
    answer: (name) =>
      `${name}: «Главная» — первая кнопка вверху слева (/). Там ближайшие КВ Main/Junior, топ паблика и сводки. Расписание ближайших слотов смотри справа на главной.`,
  },
  {
    hits: (q) =>
      score(q, [
        "расписание кв",
        "расписани",
        "когда кв",
        "ближайш кв",
        "ближайшая кв",
        "следующ кв",
        "где кв",
        "календар кв",
        "слот кв",
        "анонс кв",
      ]),
    answer: (name) =>
      `${name}: расписание КВ — на главной справа (ближайшие Main/Junior). Полный календарь: меню «Кланы» → «Клановые войны» (/cw). Свободный слот искать: «Кланы» → «Поиск КВ». Эти пункты видят участники клана.`,
  },
  {
    hits: (q) =>
      score(q, ["кланов войн", "поиск кв", " к в", " кв", "войн"]),
    answer: (name) =>
      `${name}: клановые войны — «Кланы» → «Клановые войны». Поиск КВ — соседний пункт «Поиск КВ». Ближайшие слоты ещё на главной. Победитель встречи — по сумме тикетов двух раундов.`,
  },
  {
    hits: (q) =>
      score(q, ["список кланов", "вступить в клан", "создать клан", "кланы"]),
    answer: (name) =>
      `${name}: список кланов — меню «Кланы» → «Список кланов» (/clans). Создать/вступить — оттуда же. КВ и поиск КВ — соседние пункты того же меню (для участников клана).`,
  },
  {
    hits: (q) =>
      score(q, [
        "тренировочн матч",
        "трениров",
        "tr1",
        "тр1",
        "тр 1",
        "tm ",
        "/tm",
        "явка",
      ]),
    answer: (name) =>
      `${name}: тренировочные матчи — меню «Тренировка» → «Тренировочные матчи» (/tm). Только для участников клана. Вкладки внутри: матчи, рейтинг, аналитика, развитие (роли). Стрельба — соседний пункт «Тренировка стрельбы».`,
  },
  {
    hits: (q) =>
      score(q, [
        "развити",
        "роль стрел",
        "роль медик",
        "fit",
        "тир фит",
        "kit",
        "кит ",
      ]),
    answer: (name) =>
      `${name}: развитие по ролям — «Тренировка» → «Тренировочные матчи», вкладка «Развитие» (/tm?tab=growth). Оттуда же листы ролей: стрелок, медик, SL, пулемёты, сапёр, экипаж и т.д.`,
  },
  {
    hits: (q) => score(q, ["стрельб", "аим", " aim", "/aim"]),
    answer: (name) =>
      `${name}: тренировка стрельбы — меню «Тренировка» → «Тренировка стрельбы» (/aim).`,
  },
  {
    hits: (q) =>
      score(q, ["рейтинг паблика", "паблик", "публичн", " rp", "очки rp", "/public"]),
    answer: (name) =>
      `${name}: рейтинг паблика — пункт «Рейтинг паблика» вверху (/public). История каток и RP в своём профиле; число RP берётся из уже посчитанного матча.`,
  },
  {
    hits: (q) => score(q, ["battle pass", "батл пас", "баттл", "бп ", " бп", "/battle-pass"]),
    answer: (name) =>
      `${name}: Battle Pass — кнопка «Battle Pass» в верхнем меню (/battle-pass). Награды и кастомизация (патч/стиль ника) — через BP и профиль.`,
  },
  {
    hits: (q) => score(q, ["турнир", "кубок", "fruit", "ставк", "бетс", "/tournaments"]),
    answer: (name) =>
      `${name}: турниры — пункт «Турниры» сверху (/tournaments). Ставки — /tournaments/bets. Награды за места получают игроки из заявки команды; кубки/знаки — в инвентаре профиля, на полку кладут в слот.`,
  },
  {
    hits: (q) =>
      score(q, ["резерв", "уйти в резерв", "заявк на резерв"]),
    answer: (name) =>
      `${name}: резерв — заявка, не мгновенный статус. Свой профиль → «Уйти в резерв»: дата от/до (от 4 дней) и причина. HR принимает или отклоняет. Отказ приходит в колокольчик.`,
  },
  {
    hits: (q) => score(q, ["выходн", "отгул", "дей офф", "day off"]),
    answer: (name) =>
      `${name}: выходной — в своём профиле, «Взять выходной». Это 1–3 дня, включается сразу. От 4 дней — уже «Уйти в резерв».`,
  },
  {
    hits: (q) =>
      score(q, ["сменить ник", "поменять ник", "сменить никнейм", "никнейм", "свой ник"]),
    answer: (name) =>
      `${name}: ник меняется в своём профиле, в редактировании. Статистика тренировок и КВ переезжает. Если цифры не сойдутся — напиши капитану.`,
  },
  {
    hits: (q) =>
      score(q, ["steam", "войти", "регистрац", "авториз", "зарегистр", "логин"]),
    answer: (name) =>
      `${name}: вход через Steam (кнопка справа вверху). Если анкета пустая — сайт ведёт на регистрацию. Без входа разделы клана не открываются.`,
  },
  {
    hits: (q) => score(q, ["медал", "наград", "полк", "инвентар", "патч", "стиль ник"]),
    answer: (name) =>
      `${name}: награды — инвентарь своего профиля. Чтобы знак висел на полке, положи его в слот и подтверди. Патч/стиль ника — кастомизация профиля (через Battle Pass).`,
  },
  {
    hits: (q) => score(q, ["колокольчик", "уведомлен"]),
    answer: (name) =>
      `${name}: колокольчик в шапке справа. Туда падают важные сообщения (отказ резерва, инвайты и т.п.).`,
  },
  {
    hits: (q) =>
      score(q, ["почт", "письм", "входящ", "рассылк"]),
    answer: (name) =>
      `${name}: почта клана — в своём профиле, блок «Почта» слева. Там входящие, избранное и удалённые. Письма про КВ тоже приходят сюда.`,
  },
  {
    hits: (q) => score(q, ["профиль", "где мой", "моя страниц", "/profile"]),
    answer: (name) =>
      `${name}: свой профиль — клик по нику/аватару справа вверху (/profile). Там почта, стата, выходной, резерв, инвентарь. Чужой профиль — по нику в рейтинге.`,
  },
  {
    hits: (q) => score(q, ["карта клан", "карта игроков", "/map", "где живут"]),
    answer: (name) =>
      `${name}: карта игроков — /map (если видишь ссылку в письме или разделе клана). Точки ставят участники сами.`,
  },
  {
    hits: (q) => score(q, ["репле", "replay", "/replays"]),
    answer: (name) =>
      `${name}: реплеи матчей — раздел /replays. Открывается с карточки матча, если реплей залит.`,
  },
  {
    hits: (q) => score(q, ["тикет", "техподдерж", "саппорт", "помощник"]),
    answer: (name) =>
      `${name}: ты уже в техподдержке — это это окно. Базовые вопросы по меню я закрываю сам; если не справлюсь — позову оператора. Когда всё ясно — закрой тикет кнопкой внизу.`,
  },
];

function score(q: string, keys: string[]): number {
  const soft = ` ${q.replace(/[?!.,:;…]+/g, " ").replace(/\s+/g, " ").trim()} `;
  let n = 0;
  for (const k of keys) {
    const needle = k.trim();
    if (!needle) continue;
    if (soft.includes(needle) || q.includes(needle)) n += needle.length;
  }
  return n;
}

function isYes(raw: string): boolean {
  const q = norm(raw).replace(/[?!.,:;…]+/g, "").trim();
  return /^(да|даа+|йес|yes|yep|ага|угу|ок|окей|okay|всё ясно|все ясно|помог|помогло|спасибо|спс|благодар|ясно|понял|понятно|норм|отлично|супер)$/i.test(
    q
  ) || /^(да|ага|угу|yes)[,!. ]/.test(q);
}

function isNo(raw: string): boolean {
  const q = norm(raw).replace(/[?!.,:;…]+/g, "").trim();
  return /^(нет|неа|нее+|no|nope|не то|не помог|не помогло|мимо|хз)$/i.test(q)
    || /^(нет|неа|no)[,!. ]/.test(q);
}

function isGreeting(q: string): boolean {
  return /^(привет|здравствуй|здравствуйте|хай|добрый день|добрый вечер|доброе утро|йо|ку)[.! ]*$/.test(
    q.trim()
  );
}

export function answerSupportQuestion(
  text: string,
  name: string,
  operatorAlreadyCalled: boolean
): {
  answer: string;
  callOperator: boolean;
  matched: boolean;
  chitchat?: boolean;
} {
  const q = ` ${norm(text)} `;
  if (q.trim().length < 2) {
    return {
      answer: escalate(name, operatorAlreadyCalled),
      callOperator: !operatorAlreadyCalled,
      matched: false,
    };
  }
  if (isGreeting(q.trim())) {
    return {
      answer: pick([
        `${name} на связи. Привет. Как дела? По сайту и клану — спрашивай, отвечу или позову оператора.`,
        `${name}: привет. Рация открыта. Нужна вкладка или просто поздороваться — я тут.`,
        `${name} на посту. Здорово. Кидай вопрос по меню — или просто напиши, как сам.`,
      ]),
      callOperator: false,
      matched: true,
      chitchat: true,
    };
  }
  let best = 0;
  let hit: Faq | null = null;
  for (const row of FAQ) {
    const n = row.hits(q);
    if (n > best) {
      best = n;
      hit = row;
    }
  }
  if (!hit || best < 4) {
    return {
      answer: escalate(name, operatorAlreadyCalled),
      callOperator: !operatorAlreadyCalled,
      matched: false,
    };
  }
  return {
    answer: hit.answer(name),
    callOperator: false,
    matched: true,
    chitchat: Boolean(hit.chitchat),
  };
}

type MsgRow = { id: string; kind: string; body: string };

function lastBotBeforeLastUser(messages: MsgRow[]): MsgRow | null {
  const userMsgs = messages.filter((m) => m.kind === "USER");
  const lastUser = userMsgs[userMsgs.length - 1];
  if (!lastUser) return null;
  const idx = messages.findIndex((m) => m.id === lastUser.id);
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i]?.kind === "BOT") return messages[i]!;
  }
  return null;
}

function helpCheckCount(messages: MsgRow[]): number {
  return messages.filter(
    (m) => m.kind === "BOT" && m.body.includes(SUPPORT_HELP_CHECK)
  ).length;
}

function awaitingHelpCheck(messages: MsgRow[]): boolean {
  const prevBot = lastBotBeforeLastUser(messages);
  return Boolean(prevBot?.body.includes(SUPPORT_HELP_CHECK));
}

async function postBot(
  ticketId: string,
  body: string,
  lagMs = 50
): Promise<void> {
  await prisma.supportMessage.create({
    data: {
      ticketId,
      kind: "BOT",
      body,
      createdAt: new Date(Date.now() + lagMs),
    },
  });
}

/** После сообщения игрока: благодарность или ответ / вызов оператора. */
export async function afterUserSupportMessage(opts: {
  ticketId: string;
}): Promise<{ alert: boolean }> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: opts.ticketId },
    select: {
      id: true,
      topic: true,
      agentName: true,
      needsOperator: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, body: true },
      },
    },
  });
  if (!ticket?.topic || !ticket.agentName) return { alert: false };
  const topic = ticket.topic;
  if (topic !== "suggestion" && topic !== "bug" && topic !== "question") {
    return { alert: false };
  }
  const userMsgs = ticket.messages.filter((m) => m.kind === "USER");
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return { alert: false };
  const name = ticket.agentName;
  const first = userMsgs.length <= 1;

  if (topic === "suggestion") {
    await postBot(ticket.id, first ? thanksSuggestion(name) : ackMore(name));
    if (!ticket.needsOperator) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { needsOperator: true },
      });
      return { alert: true };
    }
    return { alert: false };
  }

  if (topic === "bug") {
    await postBot(ticket.id, first ? thanksBug(name) : ackMore(name));
    if (!ticket.needsOperator) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { needsOperator: true },
      });
      return { alert: true };
    }
    return { alert: false };
  }

  // ——— question ———
  let callOperator = false;

  if (awaitingHelpCheck(ticket.messages)) {
    if (isYes(last.body)) {
      await postBot(ticket.id, askCloseTicket(name));
      return { alert: false };
    }

    const checks = helpCheckCount(ticket.messages);
    // Уже спрашивали «помог?» 2+ раза и снова «нет» / без нового хита → оператор.
    if (isNo(last.body) || checks >= 1) {
      const decided = answerSupportQuestion(
        last.body,
        name,
        ticket.needsOperator
      );
      // «нет» without new substance
      if (isNo(last.body) && norm(last.body).replace(/[?!.,:;…]+/g, "").trim().length <= 12) {
        if (checks >= 2 || ticket.needsOperator) {
          await postBot(ticket.id, escalate(name, ticket.needsOperator));
          callOperator = !ticket.needsOperator;
        } else {
          await postBot(ticket.id, askClarify(name));
          await postBot(ticket.id, SUPPORT_HELP_CHECK, 120);
        }
      } else if (decided.matched && !decided.callOperator) {
        await postBot(ticket.id, decided.answer);
        if (!decided.chitchat) {
          await postBot(ticket.id, SUPPORT_HELP_CHECK, 120);
        }
      } else if (checks >= 2 || ticket.needsOperator) {
        await postBot(ticket.id, escalate(name, ticket.needsOperator));
        callOperator = !ticket.needsOperator;
      } else {
        await postBot(ticket.id, askClarify(name));
        await postBot(ticket.id, SUPPORT_HELP_CHECK, 120);
      }

      if (callOperator) {
        await prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { needsOperator: true },
        });
      }
      return { alert: callOperator };
    }
  }

  const decided = answerSupportQuestion(last.body, name, ticket.needsOperator);
  await postBot(ticket.id, decided.answer);
  // Small-talk («как дела», погода) — без «помог?». Навигация — всегда спрашиваем.
  if (decided.matched && !decided.callOperator && !decided.chitchat) {
    await postBot(ticket.id, SUPPORT_HELP_CHECK, 120);
  }
  callOperator = decided.callOperator;
  if (callOperator && !ticket.needsOperator) {
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { needsOperator: true },
    });
  }
  return { alert: callOperator && !ticket.needsOperator };
}

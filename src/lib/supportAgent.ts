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
};

const FAQ: Faq[] = [
  {
    hits: (q) =>
      score(q, ["резерв", "уйти в резерв", "заявк на резерв"]),
    answer: (name) =>
      `${name}: резерв — это заявка, не мгновенный статус. В профиле кнопка «Уйти в резерв»: дата от, дата до (от 4 дней) и причина из списка — армия, болезнь, учёба, работа, отпуск, семья или своя. HR принимает или отклоняет. Пока не приняли, ты не в резерве. Отказ приходит в колокольчик.`,
  },
  {
    hits: (q) => score(q, ["выходн", "отгул", "дей офф", "day off"]),
    answer: (name) =>
      `${name}: выходной берётся в профиле, кнопка «Взять выходной». Это 1–3 дня, и он включается сразу. От 4 дней — уже заявка «Уйти в резерв».`,
  },
  {
    hits: (q) =>
      score(q, ["сменить ник", "поменять ник", "сменить никнейм", "никнейм", "свой ник"]),
    answer: (name) =>
      `${name}: ник меняется в своём профиле, в редактировании. Статистика тренировок и КВ переезжает со старого ника. Если цифры не сойдутся — напиши капитану.`,
  },
  {
    hits: (q) =>
      score(q, ["steam", "войти", "регистрац", "авториз", "зарегистр"]),
    answer: (name) =>
      `${name}: вход через Steam. Если анкета ещё пустая, сайт ведёт на регистрацию. Без входа разделы клана не открываются.`,
  },
  {
    hits: (q) =>
      score(q, ["рейтинг паблика", "паблик", "публичн", " rp", "очки rp"]),
    answer: (name) =>
      `${name}: рейтинг паблика — пункт «Рейтинг паблика» сверху. История каток и счёт лежат в профиле: счёт берётся из уже посчитанного матча.`,
  },
  {
    hits: (q) =>
      score(q, ["трениров", "tr1", "тр1", "тр 1", "тренировочн"]),
    answer: (name) =>
      `${name}: тренировочные матчи — меню «Тренировка», пункт «Тренировочные матчи». Его видят участники клана. Стрельба отдельно: там же «Тренировка стрельбы».`,
  },
  {
    hits: (q) =>
      score(q, ["кланов войн", "поиск кв", " к в", "кв ", "войн"]),
    answer: (name) =>
      `${name}: клановые войны и поиск КВ — в меню «Кланы». Оба пункта для тех, кто в клане. Победитель встречи считается по сумме тикетов двух раундов.`,
  },
  {
    hits: (q) => score(q, ["battle pass", "батл пас", "баттл", "бп ", " бп"]),
    answer: (name) =>
      `${name}: Battle Pass открывается одноимённой кнопкой в верхнем меню.`,
  },
  {
    hits: (q) => score(q, ["турнир", "кубок", "fruit"]),
    answer: (name) =>
      `${name}: турниры — пункт «Турниры» сверху. Награды за места получают игроки из заявки команды. Кубок и знаки, если они твои, лежат в инвентаре профиля: на полку их ставят в слот.`,
  },
  {
    hits: (q) => score(q, ["медал", "наград", "полк", "инвентар"]),
    answer: (name) =>
      `${name}: награды в инвентаре своего профиля. Чтобы знак висел на полке, его нужно положить в слот и подтвердить. Пустой слот сам чужую награду не рисует.`,
  },
  {
    hits: (q) => score(q, ["стрельб", "аим", " aim"]),
    answer: (name) =>
      `${name}: тренировка стрельбы — меню «Тренировка», пункт «Тренировка стрельбы».`,
  },
  {
    hits: (q) => score(q, ["список кланов", "вступить в клан", "кланы"]),
    answer: (name) =>
      `${name}: список кланов — меню «Кланы», пункт «Список кланов».`,
  },
  {
    hits: (q) => score(q, ["колокольчик", "уведомлен"]),
    answer: (name) =>
      `${name}: колокольчик в шапке. Туда падают важные сообщения, например отказ заявки на резерв.`,
  },
  {
    hits: (q) => score(q, ["профиль", "где мой", "моя страниц"]),
    answer: (name) =>
      `${name}: свой профиль открывается после входа, с него же выходной и заявка в резерв. Чужой профиль — по нику в рейтинге.`,
  },
];

function score(q: string, keys: string[]): number {
  let n = 0;
  for (const k of keys) {
    if (q.includes(k.trim())) n += k.trim().length;
  }
  return n;
}

export function answerSupportQuestion(
  text: string,
  name: string,
  operatorAlreadyCalled: boolean
): { answer: string; callOperator: boolean } {
  const q = ` ${norm(text)} `;
  if (q.trim().length < 2) {
    return {
      answer: escalate(name, operatorAlreadyCalled),
      callOperator: !operatorAlreadyCalled,
    };
  }
  if (
    /^(привет|здравствуй|здравствуйте|хай|добрый день|добрый вечер|доброе утро|йо|ку)[.! ]*$/.test(
      q.trim()
    )
  ) {
    return {
      answer: `${name} на связи. Привет. Пиши вопрос по сайту или клану — отвечу, если это есть в уставе. Иначе позову оператора.`,
      callOperator: false,
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
    };
  }
  return { answer: hit.answer(name), callOperator: false };
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

  let body: string;
  let callOperator = false;
  if (topic === "suggestion") {
    body = first ? thanksSuggestion(name) : ackMore(name);
    callOperator = !ticket.needsOperator;
  } else if (topic === "bug") {
    body = first ? thanksBug(name) : ackMore(name);
    callOperator = !ticket.needsOperator;
  } else {
    const decided = answerSupportQuestion(last.body, name, ticket.needsOperator);
    body = decided.answer;
    callOperator = decided.callOperator;
  }

  await prisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      kind: "BOT",
      body,
      createdAt: new Date(Date.now() + 50),
    },
  });
  if (callOperator && !ticket.needsOperator) {
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { needsOperator: true },
    });
  }
  return { alert: callOperator && !ticket.needsOperator };
}

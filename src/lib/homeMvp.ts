export type HomeMvpRow = {
  nick: string;
  medals: number;
  medic: number;
  killer: number;
  war: number;
};

export type HomeMvpBoardData = {
  kv: HomeMvpRow[];
  train: HomeMvpRow[];
  source: string;
};

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://kv.bb-squad.ru",
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function kdOf(p: { kills?: number; deaths?: number }) {
  const kills = n(p.kills);
  const deaths = n(p.deaths);
  return deaths === 0 ? kills : kills / deaths;
}

type StatRow = {
  nick: string;
  res?: number;
  nok?: number;
  kills?: number;
  deaths?: number;
  dmg?: number;
};

function pickMvps(rows: StatRow[]) {
  const empty = {
    medic: [] as string[],
    killer: [] as string[],
    damage: [] as string[],
    antiDeath: [] as string[],
  };
  const pool = rows.filter(
    (p) =>
      n(p.res) + n(p.nok) + n(p.kills) + n(p.deaths) > 0 && Boolean(p.nick)
  );
  if (!pool.length) return empty;

  const nickKey = (p: StatRow) => String(p.nick || "").toLocaleLowerCase("ru");

  const pickMedic = () => {
    const top = Math.max(...pool.map((p) => n(p.res)));
    if (top <= 0) return null;
    const tied = pool.filter((p) => n(p.res) === top);
    tied.sort((a, b) => n(b.dmg) - n(a.dmg) || nickKey(a).localeCompare(nickKey(b)));
    return tied[0].nick;
  };

  const pickKiller = () => {
    const top = Math.max(...pool.map((p) => n(p.kills)));
    if (top <= 0) return null;
    const tied = pool.filter((p) => n(p.kills) === top);
    tied.sort(
      (a, b) =>
        n(b.nok) - n(a.nok) ||
        kdOf(b) - kdOf(a) ||
        n(b.dmg) - n(a.dmg) ||
        nickKey(a).localeCompare(nickKey(b))
    );
    return tied[0].nick;
  };

  const pickDamage = () => {
    const top = Math.max(...pool.map((p) => n(p.dmg)));
    if (top <= 0) return null;
    const tied = pool.filter((p) => n(p.dmg) === top);
    tied.sort(
      (a, b) => kdOf(b) - kdOf(a) || nickKey(a).localeCompare(nickKey(b))
    );
    return tied[0].nick;
  };

  return {
    medic: [pickMedic()].filter(Boolean) as string[],
    killer: [pickKiller()].filter(Boolean) as string[],
    damage: [pickDamage()].filter(Boolean) as string[],
    antiDeath: [] as string[],
  };
}

function topFour(
  map: Map<string, { nick: string; medic: number; killer: number; war: number }>
): HomeMvpRow[] {
  return Array.from(map.values())
    .map((p) => ({
      nick: p.nick,
      medic: p.medic,
      killer: p.killer,
      war: p.war,
      medals: p.medic + p.killer + p.war,
    }))
    .filter((p) => p.medals > 0)
    .sort(
      (a, b) =>
        b.medals - a.medals ||
        b.war - a.war ||
        b.killer - a.killer ||
        a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" })
    )
    .slice(0, 4);
}

function bump(
  map: Map<string, { nick: string; medic: number; killer: number; war: number }>,
  nick: string,
  field: "medic" | "killer" | "war"
) {
  const key = nick.trim().toLowerCase();
  if (!key) return;
  const cur = map.get(key) || { nick: nick.trim(), medic: 0, killer: 0, war: 0 };
  if (nick.trim().length > cur.nick.length) cur.nick = nick.trim();
  cur[field] += 1;
  map.set(key, cur);
}

async function loadKvTop(base: string): Promise<HomeMvpRow[]> {
  const ledger = await fetchJson(`${base}/data/mvp-ledger.json`);
  const players = (ledger.players || {}) as Record<
    string,
    { mvpMedic?: number; mvpKiller?: number; mvpDamage?: number }
  >;
  const map = new Map<
    string,
    { nick: string; medic: number; killer: number; war: number }
  >();
  for (const [nick, entry] of Object.entries(players)) {
    map.set(nick.trim().toLowerCase(), {
      nick,
      medic: n(entry.mvpMedic),
      killer: n(entry.mvpKiller),
      war: n(entry.mvpDamage),
    });
  }
  return topFour(map);
}

async function loadTrainTop(base: string): Promise<HomeMvpRow[]> {
  const month = await fetchJson(`${base}/data/training/2026-09.json`);
  const map = new Map<
    string,
    { nick: string; medic: number; killer: number; war: number }
  >();
  const matches = (month.matches || []) as {
    status?: string;
    playersUrl?: string;
  }[];

  await Promise.all(
    matches.map(async (m) => {
      if (!m.playersUrl || m.status === "upcoming") return;
      const url = m.playersUrl.startsWith("http")
        ? m.playersUrl
        : `${base}/${m.playersUrl.replace(/^\//, "")}`;
      try {
        const players = await fetchJson(url);
        const list: StatRow[] =
          players.players?.length
            ? players.players
            : [].concat(players.teamA || [], players.teamB || []);
        const mvp =
          (players.mvp && players.mvp.train) ||
          pickMvps(list.filter((p) => p && p.nick));
        for (const nick of mvp.medic || []) bump(map, nick, "medic");
        for (const nick of mvp.killer || []) bump(map, nick, "killer");
        for (const nick of mvp.damage || []) bump(map, nick, "war");
      } catch {
        /* skip broken match file */
      }
    })
  );

  return topFour(map);
}

export async function buildHomeMvpBoard(): Promise<HomeMvpBoardData> {
  let lastErr: unknown;
  for (const raw of KV_BASES) {
    const base = raw.replace(/\/$/, "");
    try {
      const [kv, train] = await Promise.all([
        loadKvTop(base),
        loadTrainTop(base),
      ]);
      return { kv, train, source: base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("MVP board unavailable");
}

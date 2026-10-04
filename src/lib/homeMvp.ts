export type HomeMvpRow = {
  nick: string;
  /** Positive medals only (Medic + Killer + War). Anti never counted here. */
  medals: number;
  medic: number;
  killer: number;
  war: number;
  anti: number;
};

export type HomeMvpLane = {
  glory: HomeMvpRow[];
  anti: HomeMvpRow[];
};

export type HomeMvpBoardData = {
  train: HomeMvpLane;
  main: HomeMvpLane;
  junior: HomeMvpLane;
  source: string;
  updatedAt: string;
};

export type MvpBlock = {
  medic?: string[];
  killer?: string[];
  damage?: string[];
  antiDeath?: string[];
};

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

/** MVP матча: medic=res, killer=kills, war=dmg, anti=deaths. */
export function pickMvps(rows: StatRow[]): MvpBlock {
  const empty: MvpBlock = {
    medic: [],
    killer: [],
    damage: [],
    antiDeath: [],
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

  const pickAnti = () => {
    const top = Math.max(...pool.map((p) => n(p.deaths)));
    if (top <= 0) return null;
    const tied = pool.filter((p) => n(p.deaths) === top);
    tied.sort(
      (a, b) =>
        kdOf(a) - kdOf(b) ||
        n(a.dmg) - n(b.dmg) ||
        nickKey(a).localeCompare(nickKey(b))
    );
    return tied[0].nick;
  };

  return {
    medic: [pickMedic()].filter(Boolean) as string[],
    killer: [pickKiller()].filter(Boolean) as string[],
    damage: [pickDamage()].filter(Boolean) as string[],
    antiDeath: [pickAnti()].filter(Boolean) as string[],
  };
}

function emptyLane(): HomeMvpLane {
  return { glory: [], anti: [] };
}

export function emptyHomeMvpBoard(): HomeMvpBoardData {
  return {
    train: emptyLane(),
    main: emptyLane(),
    junior: emptyLane(),
    source: "",
    updatedAt: new Date().toISOString(),
  };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PanelkaServer } from "@/lib/panelkaRcon";

const MODES = ["SQ", "FCL", "CSL", "SEC", "HOTDROP", "LOADER"] as const;
const PAGE = 8;
const BAN_UNITS = [
  { value: "h", label: "часы" },
  { value: "d", label: "дни" },
  { value: "0", label: "навсегда" },
] as const;
type BanUnit = (typeof BAN_UNITS)[number]["value"];
const FACTIONS = [
  { id: "WPMC", label: "ЧВК СТАРОЕ" },
  { id: "TLF", label: "Турция" },
  { id: "USMC", label: "Морская Пехота" },
  { id: "GFI", label: "Иран" },
  { id: "USA", label: "Америка" },
  { id: "RGF", label: "Россия" },
  { id: "CRF", label: "Новая канада" },
  { id: "VDV", label: "ВДВ" },
  { id: "CAF", label: "Канада" },
  { id: "MEI", label: "Талибы" },
  { id: "BAF", label: "Англия" },
  { id: "IMF", label: "Сербы" },
  { id: "ADF", label: "Австралия" },
  { id: "PLA", label: "Китай" },
] as const;
const DECKS = [
  "AirAssault",
  "Armored",
  "LightInfantry",
  "Mechanized",
  "Motorized",
  "Support",
] as const;

type ChatLine = {
  clock: string;
  date?: string;
  channel: string;
  name: string;
  steamId?: string;
  text: string;
};

export type RosterPerson = {
  id: number;
  name: string;
  steamId: string;
  leader: boolean;
  role: string;
  vehicle?: string;
  health?: "alive" | "nok" | "dead" | string;
  rights?: "admin" | "moderator" | "camera" | string;
  clanColor?: string | null;
};

type RosterSquad = {
  id: string;
  name: string;
  size: number;
  locked: boolean;
  players: RosterPerson[];
  createdClock?: string;
  creatorName?: string;
  creatorSteamId?: string;
};

type RosterTeam = {
  id: string;
  name: string;
  tickets: number;
  count: number;
  squads: RosterSquad[];
  loose: RosterPerson[];
};

type ModeName = (typeof MODES)[number];

type PlayerProfile = {
  found: boolean;
  nick: string | null;
  steamId: string;
  profileUrl: string;
  steamUrl?: string;
  faction: string | null;
  factionSlug: string | null;
  publicHoursLabel: string;
  publicMinutes: number;
  sessions: number;
};

type Pb1VisitBar = {
  ymd: string;
  label: string;
  minutes: number;
  hours: number;
};

type PlayerPb1Stats = {
  hoursLabel: string;
  publicMinutes: number;
  sessions: number;
  kd: number | null;
  winsPct: number | null;
  matches: number;
  favoriteKit: string | null;
  visitDays: number;
  visitBars: Pb1VisitBar[];
  visitMaxHours: number;
  steamHoursLabel?: string | null;
  steamMinutes?: number | null;
  steam2WeeksLabel?: string | null;
  steamPlayStatus?: "ok" | "private" | "error" | "no_key" | "unknown";
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
    offsetFromMsk: number | null;
    offsetLabel: string | null;
    ip: string | null;
    source: "geoip" | "none";
  };
};

type NickHistoryRow = {
  nick: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  source: string;
};

type PlayerMemoRow = {
  id: string;
  kind: "note" | "label";
  text: string;
  byNick: string;
  createdAt: string;
};

type TeamKillRow = {
  date: string;
  clock: string;
  victim: string;
  victimSteamId?: string;
};

type PunishmentRow = {
  kind: "kick" | "ban" | "warn" | "report" | string;
  date: string;
  clock: string;
  reason: string;
  duration?: string;
  by: string;
  source?: string;
};

type ModAction = "team" | "kick" | "ban" | "unsquad" | "warn" | "camera" | null;

type ServerMod = {
  id: string;
  title: string;
  localUpdated: number;
  steamUpdated: number;
  needsUpdate: boolean;
  inLoadOrder: boolean;
};

type LeaveRow = {
  at: string;
  steamId: string;
  nick: string;
  steamUrl: string;
  source?: string;
};

type AdminPanelkaProps = {
  backHref?: string;
  backLabel?: string;
};

export function AdminPanelka({
  backHref = "/admin",
  backLabel = "К админке",
}: AdminPanelkaProps = {}) {
  const initialPlace = useMemo(() => readPanelkaPlace(), []);
  const [servers, setServers] = useState<PanelkaServer[]>(() => placeholderServers());
  const [loadedKeys, setLoadedKeys] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string>(() => initialPlace.selected);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterOnce, setRosterOnce] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mgmtOpen, setMgmtOpen] = useState(() => initialPlace.mgmtOpen);
  const [modsOpen, setModsOpen] = useState(() => initialPlace.modsOpen);
  const [leavesOpen, setLeavesOpen] = useState(true);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const restoreScrollY = useRef(initialPlace.scrollY);
  const didRestoreScroll = useRef(false);
  const paintCacheRef = useRef<Map<string, { rights?: string; clanColor?: string | null }>>(
    new Map()
  );
  const [mode, setMode] = useState<ModeName | "">("");
  const [layers, setLayers] = useState<Record<string, string[]> | null>(null);
  const [pickedLayer, setPickedLayer] = useState("");
  const [faction1, setFaction1] = useState("");
  const [faction2, setFaction2] = useState("");
  const [deck1, setDeck1] = useState("");
  const [deck2, setDeck2] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("Команды, готовность?");
  const [askSend, setAskSend] = useState(false);
  const [sentLine, setSentLine] = useState("");
  const [modPlayer, setModPlayer] = useState<RosterPerson | null>(null);
  const [serverMods, setServerMods] = useState<ServerMod[]>([]);
  const [modsBusy, setModsBusy] = useState(false);
  const [modDraft, setModDraft] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  const rosterRef = useRef<HTMLDivElement>(null);

  const mergeServer = useCallback((row: PanelkaServer) => {
    setServers((prev) => {
      const base = prev.length ? prev : placeholderServers();
      return base.map((s) => (s.key === row.key ? { ...s, ...row } : s));
    });
    setLoadedKeys((prev) => ({ ...prev, [row.key]: true }));
    try {
      const raw = localStorage.getItem("panelka-status-v1");
      const saved = raw ? (JSON.parse(raw) as PanelkaServer[]) : placeholderServers();
      const next = (Array.isArray(saved) && saved.length ? saved : placeholderServers()).map((s) =>
        s.key === row.key ? { ...s, ...row } : s
      );
      localStorage.setItem("panelka-status-v1", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshOne = useCallback(
    async (key: string) => {
      const res = await fetch(`/api/admin/panelka?op=status&key=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok?: boolean; servers?: PanelkaServer[]; error?: string };
      if (!res.ok || !data.ok || !data.servers?.[0]) {
        setLoadError(data.error || "не удалось прочитать сервер");
        return false;
      }
      setLoadError("");
      mergeServer(data.servers[0]);
      return true;
    },
    [mergeServer]
  );

  const loadRoster = useCallback(async (key: string, quiet = false) => {
    if (!quiet) setRosterBusy(true);
    try {
      const q = quiet ? "&quiet=1" : "";
      const res = await fetch(`/api/admin/panelka?op=roster&key=${encodeURIComponent(key)}${q}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        teams?: RosterTeam[];
        error?: string;
        ms?: number;
        cached?: boolean;
      };
      if (!data.ok || !data.teams) {
        if (!quiet) setNotice(data.error || "список игроков не пришёл");
        return;
      }
      let next = data.teams;
      if (quiet) {
        // Тихий полл без paint — подмешиваем кэш прав/цвета с прошлого полного ответа
        const paint = paintCacheRef.current;
        next = data.teams.map((team) => ({
          ...team,
          squads: (team.squads || []).map((sq) => ({
            ...sq,
            players: (sq.players || []).map((p) => {
              const hit = paint.get(p.steamId);
              return hit
                ? { ...p, rights: hit.rights ?? p.rights, clanColor: hit.clanColor ?? p.clanColor }
                : p;
            }),
          })),
          loose: (team.loose || []).map((p) => {
            const hit = paint.get(p.steamId);
            return hit
              ? { ...p, rights: hit.rights ?? p.rights, clanColor: hit.clanColor ?? p.clanColor }
              : p;
          }),
        }));
      } else {
        const paint = new Map<string, { rights?: string; clanColor?: string | null }>();
        for (const team of data.teams) {
          for (const sq of team.squads || []) {
            for (const p of sq.players || []) {
              if (p.steamId) paint.set(p.steamId, { rights: p.rights, clanColor: p.clanColor });
            }
          }
          for (const p of team.loose || []) {
            if (p.steamId) paint.set(p.steamId, { rights: p.rights, clanColor: p.clanColor });
          }
        }
        paintCacheRef.current = paint;
      }
      setTeams(next);
      setRosterOnce(true);
    } finally {
      if (!quiet) setRosterBusy(false);
    }
  }, []);

  const loadMods = useCallback(async (key: string) => {
    setModsBusy(true);
    try {
      const res = await fetch(`/api/admin/panelka?op=mods&key=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok?: boolean; mods?: ServerMod[]; error?: string };
      if (!data.ok) {
        setNotice(data.error || "моды не прочитались");
        return;
      }
      setServerMods(data.mods || []);
    } finally {
      setModsBusy(false);
    }
  }, []);

  const loadChat = useCallback(async (key: string) => {
    const res = await fetch(`/api/admin/panelka?op=chat&key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { ok?: boolean; messages?: ChatLine[] };
    if (data.ok && data.messages) setChat(data.messages);
  }, []);

  const loadLeaves = useCallback(async (key: string) => {
    const res = await fetch(`/api/admin/panelka?op=leaves&key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { ok?: boolean; leaves?: LeaveRow[] };
    if (data.ok && Array.isArray(data.leaves)) setLeaves(data.leaves);
  }, []);

  // No auto status/roster for all servers — only after click on a card.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("panelka-status-v1");
      const saved = raw ? (JSON.parse(raw) as PanelkaServer[]) : null;
      if (Array.isArray(saved) && saved.length) {
        setServers(placeholderServers().map((ph) => {
          const hit = saved.find((s) => s.key === ph.key);
          return hit && hit.map && hit.map !== "нажми" ? { ...ph, ...hit } : ph;
        }));
        const marks: Record<string, boolean> = {};
        for (const row of saved) {
          if (row?.key && row.map && row.map !== "нажми" && row.map !== "читаю…") {
            marks[row.key] = true;
          }
        }
        setLoadedKeys(marks);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Remember selected server + open folds across refresh
  useEffect(() => {
    writePanelkaPlace({
      selected,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      mgmtOpen,
      modsOpen,
    });
  }, [selected, mgmtOpen, modsOpen]);

  useEffect(() => {
    let tick = 0;
    const onScroll = () => {
      window.clearTimeout(tick);
      tick = window.setTimeout(() => {
        writePanelkaPlace({
          selected,
          scrollY: window.scrollY,
          mgmtOpen,
          modsOpen,
        });
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(tick);
      window.removeEventListener("scroll", onScroll);
    };
  }, [selected, mgmtOpen, modsOpen]);

  useEffect(() => {
    setAskSend(false);
    setSentLine("");
    setModPlayer(null);
    setMapOpen(false);
    setModDraft("");
    if (!selected) {
      setChat([]);
      setTeams([]);
      setServerMods([]);
      setLeaves([]);
      setRosterOnce(false);
      return;
    }
    setRosterOnce(false);
    setTeams([]);
    setLeaves([]);
    setServerMods([]);
    paintCacheRef.current = new Map();
    let stop = false;
    const key = selected;
    const boot = async () => {
      // Быстрый первый кадр: статус + игроки + чат + выходы. Моды — отдельно (медленнее).
      void refreshOne(key);
      await Promise.all([loadRoster(key), loadChat(key), loadLeaves(key)]);
      if (stop) return;
      void loadMods(key);
    };
    void boot();
    // Пока открыта эта панель — раз в 10с тихо обновляем актуальные блоки
    const pollTimer = window.setInterval(() => {
      if (stop) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshOne(key);
      void loadRoster(key, true);
      void loadChat(key);
      void loadLeaves(key);
    }, 10000);
    return () => {
      stop = true;
      window.clearInterval(pollTimer);
    };
  }, [selected, refreshOne, loadRoster, loadMods, loadChat, loadLeaves]);

  // After refresh: put viewport back where it was (once content is ready)
  useEffect(() => {
    if (didRestoreScroll.current) return;
    if (!selected) {
      didRestoreScroll.current = true;
      return;
    }
    if (!rosterOnce && rosterBusy) return;
    const y = restoreScrollY.current;
    if (y <= 0) {
      didRestoreScroll.current = true;
      return;
    }
    const t1 = window.setTimeout(() => window.scrollTo(0, y), 40);
    const t2 = window.setTimeout(() => {
      window.scrollTo(0, y);
      didRestoreScroll.current = true;
    }, 280);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [selected, rosterOnce, rosterBusy]);

  useEffect(() => {
    const node = chatRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat]);

  const current = servers.find((server) => server.key === selected) || null;
  const teamA = teams.find((team) => team.id === "1") || null;
  const teamB = teams.find((team) => team.id === "2") || null;

  async function send(
    action: string,
    extra: {
      layer?: string;
      steamId?: string;
      message?: string;
      reason?: string;
      duration?: string;
      faction1?: string;
      faction2?: string;
      deck1?: string;
      deck2?: string;
      mod?: string;
      targetName?: string;
      teamId?: string;
      squadId?: string;
      squadName?: string;
    }
  ) {
    if (!selected) return false;
    setBusy(action);
    setNotice("");
    try {
      const res = await fetch("/api/admin/panelka", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected, action, ...extra }),
      });
      const data = (await res.json()) as { ok?: boolean; reply?: string; error?: string };
      const ok = Boolean(res.ok && data.ok);
      setNotice(ok ? data.reply || "готово" : data.error || "не вышло");
      if (ok) {
        window.setTimeout(() => {
          void refreshOne(selected);
          void loadRoster(selected, true);
          if (action === "mod-install" || action === "mod-remove" || action === "server-restart") {
            void loadMods(selected);
          }
        }, 1200);
      }
      return ok;
    } catch {
      setNotice("нет связи с сайтом");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function confirmSay() {
    const text = draft.trim();
    const key = selected;
    if (!text || !key || busy) return;
    const ok = await send("say", { message: text });
    if (!ok) return;
    setAskSend(false);
    setDraft("");
    setSentLine(`Ушло на ${key}: ${text}`);
    setNotice(`Сообщение ушло на ${key}`);
    window.setTimeout(() => {
      void fetch(`/api/admin/panelka?op=chat&key=${key}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data: { ok?: boolean; messages?: ChatLine[] }) => {
          if (data.ok && data.messages) setChat(data.messages);
        });
    }, 1500);
  }

  async function openMaps() {
    if (!selected) return;
    setMgmtOpen(true);
    setMapOpen(true);
    setMode("SQ");
    setPickedLayer("");
    setFaction1("");
    setFaction2("");
    setDeck1("");
    setDeck2("");
    if (layers) return;
    setBusy("layers");
    try {
      const res = await fetch("/api/admin/panelka?op=layers", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        modes?: Record<string, string[]>;
        error?: string;
      };
      if (!data.ok || !data.modes) {
        setNotice(data.error || "список карт не пришёл");
        setMapOpen(false);
        return;
      }
      setLayers(data.modes);
    } finally {
      setBusy("");
    }
  }

  function changeLayer(action: "change-now" | "change-next") {
    if (!pickedLayer) return;
    const extras =
      faction1 && faction2
        ? { faction1, faction2, deck1, deck2 }
        : {};
    void send(action, { layer: pickedLayer, ...extras });
  }

  function selectServer(key: string) {
    const same = key === selected;
    setSelected(key);
    // Fresh click jumps to roster; refresh restore uses saved scrollY instead
    if (!same) {
      didRestoreScroll.current = true;
      restoreScrollY.current = 0;
      window.setTimeout(() => {
        rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  return (
    <div className="panelka-shell">
      <header className="panelka-head">
        <div>
          <p className="eyebrow">админ</p>
          <h1>Панель серверов</h1>
          <p className="lead">
            TR1–TR5 и PB1. Карта, фракции, моды, рестарт. Доступ: Keech, HR, зам,
            администратор и модератор паблика.
          </p>
        </div>
        <a className="panelka-back" href={backHref}>
          {backLabel}
        </a>
      </header>

      {loadError ? <p className="panelka-notice">{loadError}</p> : null}

      <div className="panelka-grid">
        {servers.map((server) => {
          const ready = Boolean(loadedKeys[server.key]);
          return (
            <article
              key={server.key}
              className={`panelka-card${selected === server.key ? " is-on" : ""}`}
            >
              <button type="button" className="panelka-card-main" onClick={() => selectServer(server.key)}>
                <b>{ready ? server.name : server.key}</b>
                <span>{ready ? server.map || "карта неизвестна" : "нажми, чтобы загрузить"}</span>
                {ready ? (
                  <span className="panelka-uptime">
                    {formatUptimeSec(server.uptimeSec) || "рестарт: нет данных"}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className="panelka-count"
                onClick={() => selectServer(server.key)}
              >
                {ready ? (
                  <>
                    <span>
                      {server.players} / {server.maxPlayers || 100}
                    </span>
                    <span className="panelka-queue">
                      очередь {typeof server.queue === "number" ? server.queue : 0}
                    </span>
                  </>
                ) : (
                  <span>не загружен</span>
                )}
              </button>
            </article>
          );
        })}
      </div>

      <section className="panelka-desk">
        <button
          type="button"
          className={`panelka-fold-head${mgmtOpen ? " is-open" : ""}`}
          onClick={() => setMgmtOpen((v) => !v)}
          aria-expanded={mgmtOpen}
        >
          <h2>Управление</h2>
          <span>{mgmtOpen ? "свернуть" : "открыть"}</span>
        </button>
        {mgmtOpen ? (
          <div className="panelka-fold-body">
            {current ? (
              <p className="panelka-picked">
                Выбран {current.key}: {current.name}
                {" · "}
                {current.players}/{current.maxPlayers || 100}
                {" · очередь "}
                {typeof current.queue === "number" ? current.queue : 0}
              </p>
            ) : (
              <p className="panelka-picked">Сначала нажми один из серверов сверху.</p>
            )}
            <div className="panelka-actions">
              <button
                type="button"
                disabled={!current || Boolean(busy)}
                onClick={() => void openMaps()}
              >
                1. Смена карты
              </button>
              <button
                type="button"
                disabled={!current || Boolean(busy)}
                onClick={() => {
                  if (current && window.confirm(`Рестарт матча на ${current.key}?`)) {
                    void send("restart", {});
                  }
                }}
              >
                2. Рестарт матча
              </button>
              <button
                type="button"
                disabled={!current || Boolean(busy)}
                onClick={() => {
                  if (current && window.confirm(`Закончить текущую карту на ${current.key}?`)) {
                    void send("end", {});
                  }
                }}
              >
                3. Закончить карту
              </button>
              <button
                type="button"
                disabled={!current || Boolean(busy)}
                onClick={() => {
                  if (
                    current &&
                    window.confirm(
                      `Полный рестарт сервера ${current.key}?\nКикнет всех игроков. Нужен после установки/обновления модов.`
                    )
                  ) {
                    void send("server-restart", {});
                  }
                }}
              >
                {busy === "server-restart" ? "Рестартую…" : "4. Рестарт сервера"}
              </button>
            </div>
            {busy ? <p className="panelka-notice">Жду сервер…</p> : null}
            {notice ? <p className="panelka-notice">{notice}</p> : null}

            {mapOpen && current ? (
              <div className="panelka-maps">
                <div className="panelka-modes">
                  {MODES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={mode === item ? "is-on" : ""}
                      onClick={() => {
                        setMode(item);
                        setPickedLayer("");
                      }}
                    >
                      {item === "SQ" ? "Ваниль SQ" : item === "HOTDROP" ? "HotDrop" : item}
                    </button>
                  ))}
                </div>
                {mode && layers ? (
                  <div className="panelka-layer-list">
                    {(layers[mode] || []).map((layer) => (
                      <button
                        key={layer}
                        type="button"
                        className={pickedLayer === layer ? "is-on" : ""}
                        onClick={() => setPickedLayer(layer)}
                      >
                        {layer}
                      </button>
                    ))}
                  </div>
                ) : null}
                {pickedLayer ? (
                  <div className="panelka-layer-setup">
                    <p className="panelka-picked">
                      Слой: <b>{pickedLayer}</b>. Фракции и деки — по желанию (обе команды сразу).
                    </p>
                    <div className="panelka-factions">
                      <label>
                        Команда 1
                        <select value={faction1} onChange={(e) => setFaction1(e.target.value)}>
                          <option value="">без выбора</option>
                          {FACTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.id} — {item.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={deck1}
                          onChange={(e) => setDeck1(e.target.value)}
                          disabled={!faction1}
                        >
                          <option value="">дека любая</option>
                          {DECKS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Команда 2
                        <select value={faction2} onChange={(e) => setFaction2(e.target.value)}>
                          <option value="">без выбора</option>
                          {FACTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.id} — {item.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={deck2}
                          onChange={(e) => setDeck2(e.target.value)}
                          disabled={!faction2}
                        >
                          <option value="">дека любая</option>
                          {DECKS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="panelka-confirm">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => changeLayer("change-now")}
                      >
                        Сменить сейчас
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => changeLayer("change-next")}
                      >
                        Сменить после конца раунда
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {current ? (
          <div className="panelka-mods panelka-mods-fold">
            <button
              type="button"
              className={`panelka-fold-head${modsOpen ? " is-open" : ""}`}
              onClick={() => setModsOpen((v) => !v)}
              aria-expanded={modsOpen}
            >
              <h3>Моды {current.key}</h3>
              <span>{modsOpen ? "свернуть" : "открыть"}</span>
            </button>
            {modsOpen ? (
              <div className="panelka-fold-body">
                <div className="panelka-live-head">
                  <p className="panelka-picked" style={{ margin: 0 }}>
                    ID или ссылка Steam Workshop. После установки/удаления нужен рестарт сервера.
                  </p>
                  <button
                    type="button"
                    disabled={modsBusy || Boolean(busy)}
                    onClick={() => void loadMods(current.key)}
                  >
                    {modsBusy ? "Читаю…" : "Обновить"}
                  </button>
                </div>
                <form
                  className="panelka-mods-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = modDraft.trim();
                    if (!value || busy) return;
                    void send("mod-install", { mod: value }).then((ok) => {
                      if (ok) setModDraft("");
                    });
                  }}
                >
                  <input
                    value={modDraft}
                    onChange={(event) => setModDraft(event.target.value)}
                    placeholder="3809872236 или https://steamcommunity.com/sharedfiles/filedetails/?id=…"
                  />
                  <button type="submit" disabled={!modDraft.trim() || Boolean(busy)}>
                    {busy === "mod-install" ? "Ставлю…" : "Установить"}
                  </button>
                </form>
                <div className="panelka-mods-list">
                  {serverMods.length ? (
                    serverMods.map((mod) => (
                      <article key={mod.id} className={mod.needsUpdate ? "is-stale" : ""}>
                        <div>
                          <b>{mod.title}</b>
                          <span>ID {mod.id}</span>
                          <span>
                            на сервере: {formatUnix(mod.localUpdated)} · в Workshop:{" "}
                            {mod.steamUpdated ? formatUnix(mod.steamUpdated) : "—"}
                          </span>
                          {mod.needsUpdate ? <em>есть новое обновление</em> : null}
                        </div>
                        <div className="panelka-mods-list-actions">
                          {mod.needsUpdate ? (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Обновить мод ${mod.title} (${mod.id}) с Workshop на ${current.key}? После этого нужен рестарт сервера.`
                                  )
                                ) {
                                  void send("mod-install", { mod: mod.id });
                                }
                              }}
                            >
                              {busy === "mod-install" ? "Обновляю…" : "Обновить"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Удалить мод ${mod.title} (${mod.id}) с ${current.key}?`
                                )
                              ) {
                                void send("mod-remove", { mod: mod.id });
                              }
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="panelka-chat-empty">
                      {modsBusy ? "Читаю моды…" : "Модов нет."}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {current ? (
          <div className="panelka-leaves panelka-mods-fold">
            <button
              type="button"
              className={`panelka-fold-head${leavesOpen ? " is-open" : ""}`}
              onClick={() => setLeavesOpen((v) => !v)}
              aria-expanded={leavesOpen}
            >
              <h3>Вышедшие игроки {current.key}</h3>
              <span>{leavesOpen ? "свернуть" : "открыть"}</span>
            </button>
            {leavesOpen ? (
              <div className="panelka-fold-body">
                <div className="panelka-live-head">
                  <p className="panelka-picked" style={{ margin: 0 }}>
                    Живой лог выходов. Ник — ссылка в Steam. Записи старше 30 мин сами
                    пропадают.
                  </p>
                  <button type="button" onClick={() => void loadLeaves(current.key)}>
                    Обновить
                  </button>
                </div>
                <div className="panelka-leaves-log" role="log" aria-live="polite">
                  {leaves.length ? (
                    leaves.map((row) => (
                      <p key={`${row.steamId}-${row.at}`}>
                        <span>{row.at}</span>
                        <a
                          className="panelka-leaves-nick"
                          href={row.steamUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={row.steamId}
                        >
                          {row.nick}
                        </a>
                        <span className="panelka-leaves-sid">{row.steamId}</span>
                      </p>
                    ))
                  ) : (
                    <p className="panelka-chat-empty">
                      Пока пусто — выходы пишутся в лог, когда кто-то уходит с сервера.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {current ? (
          <div className="panelka-live-roster" ref={rosterRef}>
            <div className="panelka-live-head">
              <h3>Игроки на {current.key}</h3>
              <button
                type="button"
                disabled={rosterBusy || Boolean(busy)}
                onClick={() => void loadRoster(current.key)}
              >
                {rosterBusy ? "Обновляю…" : "Обновить"}
              </button>
            </div>
            <p className="panelka-picked">
              Слева команда 1, справа команда 2. Нажми игрока — карточка. У отряда: сбросить имя или
              распустить. Список обновляется сам раз в 10 сек.
            </p>
            <div className="panelka-roster">
              <TeamColumn
                team={teamA}
                side="a"
                emptyLabel="Команда 1 пуста"
                busy={Boolean(busy)}
                onPick={setModPlayer}
                onSquadAction={(kind, squad) =>
                  void send(kind === "disband" ? "disband-squad" : "rename-squad", {
                    teamId: teamA?.id || "1",
                    squadId: squad.id,
                    squadName: squad.name,
                    targetName: squad.name,
                  })
                }
              />
              <TeamColumn
                team={teamB}
                side="b"
                emptyLabel="Команда 2 пуста"
                busy={Boolean(busy)}
                onPick={setModPlayer}
                onSquadAction={(kind, squad) =>
                  void send(kind === "disband" ? "disband-squad" : "rename-squad", {
                    teamId: teamB?.id || "2",
                    squadId: squad.id,
                    squadName: squad.name,
                    targetName: squad.name,
                  })
                }
              />
            </div>
            {rosterBusy && !rosterOnce ? (
              <p className="panelka-chat-empty">Гружу список игроков… обычно до 5 сек.</p>
            ) : null}
            {!teamA && !teamB && rosterOnce && !rosterBusy ? (
              <p className="panelka-chat-empty">На сервере никого нет.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {current ? (
        <section className="panelka-desk panelka-chat">
          <h2>Чат {current.key}</h2>
          <p className="panelka-picked">
            Сообщение видят все на сервере. В ленте — что пишут в чат: всем, команде, скваду и админам.
          </p>
          <div className="panelka-chat-log" ref={chatRef}>
            {chat.length ? (
              chat.map((line, index) => {
                const canOpen =
                  Boolean(line.steamId) ||
                  (line.name && line.name !== "Админ" && findRosterPerson(teams, line.name));
                return (
                  <p key={`${line.clock}-${index}`}>
                    <span>
                      {line.date ? `${line.date} ` : ""}
                      {line.clock}
                    </span>
                    <span>{line.channel}</span>
                    {canOpen ? (
                      <button
                        type="button"
                        className="panelka-chat-nick"
                        onClick={() => {
                          const picked = pickChatPlayer(line, teams);
                          if (picked) setModPlayer(picked);
                        }}
                      >
                        {line.name}
                      </button>
                    ) : (
                      <b>{line.name}</b>
                    )}
                    {line.text}
                  </p>
                );
              })
            ) : (
              <p className="panelka-chat-empty">Пока пусто.</p>
            )}
          </div>
          <form
            className="panelka-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim() || busy) return;
              setSentLine("");
              setAskSend(true);
            }}
          >
            <input
              value={draft}
              maxLength={160}
              onChange={(event) => {
                setDraft(event.target.value);
                setAskSend(false);
              }}
              placeholder="Команды, готовность?"
            />
            <button type="submit" disabled={!draft.trim() || Boolean(busy)}>
              Написать всем
            </button>
          </form>
          {askSend && draft.trim() ? (
            <div className="panelka-chat-ask">
              <p>Отправить на {current.key} всем игрокам?</p>
              <b>{draft.trim()}</b>
              <div>
                <button type="button" disabled={Boolean(busy)} onClick={() => void confirmSay()}>
                  {busy === "say" ? "Отправляю…" : "Отправить"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => setAskSend(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          {sentLine ? <p className="panelka-chat-sent">{sentLine}</p> : null}
        </section>
      ) : null}

      {modPlayer && selected ? (
        <PlayerModModal
          serverKey={selected}
          player={modPlayer}
          busy={Boolean(busy)}
          onClose={() => setModPlayer(null)}
          onAction={async (action, payload) => {
            const ok = await send(action, {
              steamId: modPlayer.steamId,
              targetName: modPlayer.name,
              ...payload,
            });
            if (ok && (action === "kick" || action === "ban" || action === "team" || action === "unsquad")) {
              if (action === "kick" || action === "ban") {
                // Optimistic: remove player from local roster immediately
                const sid = modPlayer.steamId;
                setTeams((prev) =>
                  prev.map((team) => ({
                    ...team,
                    squads: team.squads.map((squad) => ({
                      ...squad,
                      players: squad.players.filter((p) => p.steamId !== sid),
                      size: Math.max(
                        0,
                        squad.players.filter((p) => p.steamId !== sid).length
                      ),
                    })),
                    loose: team.loose.filter((p) => p.steamId !== sid),
                    count: Math.max(
                      0,
                      team.squads.reduce(
                        (n, s) => n + s.players.filter((p) => p.steamId !== sid).length,
                        0
                      ) + team.loose.filter((p) => p.steamId !== sid).length
                    ),
                  }))
                );
              }
              setModPlayer(null);
            }
            return ok;
          }}
        />
      ) : null}
    </div>
  );
}

function findRosterPerson(teams: RosterTeam[], name: string): RosterPerson | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  for (const team of teams) {
    for (const squad of team.squads) {
      for (const player of squad.players) {
        if (player.name.toLowerCase() === want || player.name.toLowerCase().includes(want)) {
          return player;
        }
      }
    }
    for (const player of team.loose) {
      if (player.name.toLowerCase() === want || player.name.toLowerCase().includes(want)) {
        return player;
      }
    }
  }
  return null;
}

function pickChatPlayer(line: ChatLine, teams: RosterTeam[]): RosterPerson | null {
  if (line.steamId) {
    const fromRoster = teams
      .flatMap((team) => [...team.squads.flatMap((s) => s.players), ...team.loose])
      .find((p) => p.steamId === line.steamId);
    if (fromRoster) return fromRoster;
    return {
      id: 0,
      name: line.name,
      steamId: line.steamId,
      leader: false,
      role: "",
    };
  }
  return findRosterPerson(teams, line.name);
}

function isDefaultSquadName(id: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === `squad ${id}` ||
    n === `отряд ${id}` ||
    n === `squad${id}` ||
    n === id
  );
}

function TeamColumn({
  team,
  side,
  emptyLabel,
  busy,
  onPick,
  onSquadAction,
}: {
  team: RosterTeam | null;
  side: "a" | "b";
  emptyLabel: string;
  busy: boolean;
  onPick: (player: RosterPerson) => void;
  onSquadAction: (kind: "disband" | "rename", squad: RosterSquad) => void;
}) {
  const [ask, setAsk] = useState<{
    kind: "disband" | "rename";
    squad: RosterSquad;
  } | null>(null);

  return (
    <section className={side === "a" ? "is-a" : "is-b"}>
      <header>
        <b>{team?.name || (side === "a" ? "Команда 1" : "Команда 2")}</b>
        <span>{team?.count ?? 0}</span>
        {team ? <span>{team.tickets} тикетов</span> : null}
      </header>
      {(team?.squads || []).map((squad) => {
        const canRename = !isDefaultSquadName(squad.id, squad.name);
        return (
          <div key={squad.id} className="panelka-squad">
            <div className="panelka-squad-head">
              <span>{squad.id}</span>
              <b>{squad.name}</b>
              {squad.createdClock || squad.creatorName ? (
                <em className="panelka-squad-meta" title="время создания и создатель">
                  {squad.createdClock ? <span className="panelka-squad-time">{squad.createdClock}</span> : null}
                  {squad.creatorName ? (
                    <span className="panelka-squad-creator">({squad.creatorName})</span>
                  ) : null}
                </em>
              ) : null}
              <span>
                {squad.size}
                {squad.locked ? " · закрыт" : ""}
              </span>
            </div>
            <div className="panelka-squad-actions">
              {canRename ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAsk({ kind: "rename", squad })}
                >
                  Сбросить имя
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                className="is-danger"
                onClick={() => setAsk({ kind: "disband", squad })}
              >
                Распустить
              </button>
            </div>
            {ask && ask.squad.id === squad.id ? (
              <div className="panelka-squad-ask">
                <p>
                  {ask.kind === "disband"
                    ? `Распустить отряд «${squad.name}» полностью?`
                    : `Сбросить имя «${squad.name}» до Squad ${squad.id}?`}
                </p>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onSquadAction(ask.kind, squad);
                      setAsk(null);
                    }}
                  >
                    Да
                  </button>
                  <button type="button" disabled={busy} onClick={() => setAsk(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
            {squad.players.map((player) => (
              <RosterRow key={`${player.steamId}-${player.id}`} player={player} onPick={onPick} />
            ))}
          </div>
        );
      })}
      {team?.loose?.length ? (
        <div className="panelka-squad">
          <div className="panelka-squad-head">
            <b>Без сквада</b>
            <span>{team.loose.length}</span>
          </div>
          {team.loose.map((player) => (
            <RosterRow key={`${player.steamId}-${player.id}`} player={player} onPick={onPick} />
          ))}
        </div>
      ) : null}
      {!team || (!team.squads.length && !team.loose.length) ? (
        <p className="panelka-chat-empty" style={{ padding: "10px 12px" }}>
          {emptyLabel}
        </p>
      ) : null}
    </section>
  );
}

function RosterRow({
  player,
  onPick,
}: {
  player: RosterPerson;
  onPick: (player: RosterPerson) => void;
}) {
  const rights = player.rights || "";
  const rightsClass =
    rights === "admin"
      ? " is-admin"
      : rights === "moderator"
        ? " is-mod"
        : rights === "camera"
          ? " is-camera"
          : player.clanColor
            ? " is-clan"
            : "";
  const health = player.health || "alive";
  const classes = [
    "panelka-slot",
    "is-click",
    player.leader ? "is-lead" : "",
    rightsClass.trim(),
    health === "nok" ? "is-nok" : "",
    health === "dead" ? "is-dead" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const nickStyle =
    !rights && player.clanColor
      ? ({ ["--clan-nick" as string]: player.clanColor } as CSSProperties)
      : undefined;
  return (
    <button
      type="button"
      className={classes}
      style={nickStyle}
      title={player.steamId}
      onClick={() => onPick(player)}
    >
      <span className="panelka-role">{player.leader ? "СЛ" : player.role || "—"}</span>
      <span className="panelka-slot-main">
        <b>{player.name}</b>
        <span className="panelka-slot-flags">
          {rights === "admin" ? <em className="is-admin">админ</em> : null}
          {rights === "moderator" ? <em className="is-mod">мод</em> : null}
          {rights === "camera" ? <em className="is-camera">камера</em> : null}
          {health === "nok" ? <em className="is-nok">нок</em> : null}
          {health === "dead" ? <em className="is-dead">мёртв</em> : null}
          {player.vehicle ? <em className="is-veh">{player.vehicle}</em> : null}
        </span>
      </span>
      <span className="panelka-slot-hint">карточка</span>
    </button>
  );
}

export function PlayerModModal({
  serverKey,
  player,
  busy,
  onClose,
  onAction,
}: {
  serverKey: string;
  player: RosterPerson;
  busy: boolean;
  onClose: () => void;
  onAction: (
    action: "team" | "kick" | "ban" | "unsquad" | "warn" | "camera-add",
    payload: { reason?: string; duration?: string; message?: string }
  ) => Promise<boolean>;
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [pb1Stats, setPb1Stats] = useState<PlayerPb1Stats | null>(null);
  const [visitHover, setVisitHover] = useState<string | null>(null);
  const [nickHistory, setNickHistory] = useState<NickHistoryRow[]>([]);
  const [notes, setNotes] = useState<PlayerMemoRow[]>([]);
  const [labels, setLabels] = useState<PlayerMemoRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [memoBusy, setMemoBusy] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [teamkills, setTeamkills] = useState<TeamKillRow[]>([]);
  const [punishments, setPunishments] = useState<PunishmentRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pending, setPending] = useState<ModAction>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const [reason, setReason] = useState("");
  const [banUnit, setBanUnit] = useState<BanUnit>("d");
  const [banAmount, setBanAmount] = useState("1");
  const [warnText, setWarnText] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [hasCamera, setHasCamera] = useState(false);
  const [tab, setTab] = useState<"chat" | "punish" | "tk">("chat");
  const [chatPage, setChatPage] = useState(0);
  const [tkPage, setTkPage] = useState(0);
  const [punishPage, setPunishPage] = useState(0);

  const loadCard = useCallback(
    (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!silent) {
        setLoading(true);
        setHistoryLoading(true);
        setLoadError("");
      }
      const q =
        `steamId=${encodeURIComponent(player.steamId)}` +
        `&name=${encodeURIComponent(player.name)}`;
      const keyQ = `key=${encodeURIComponent(serverKey)}&${q}`;

      // 1) Disk PB1 — paint stats immediately
      void fetch(`/api/admin/panelka?op=player-pb1-stats&${q}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            pb1Stats?: PlayerPb1Stats | null;
          } | null;
          if (res.ok && data?.ok && data.pb1Stats) {
            setPb1Stats(data.pb1Stats);
          }
        })
        .catch(() => null);

      // 2) Fast shell: profile / memos / nick history (no RCON)
      const shellCtrl = new AbortController();
      const shellTimer = window.setTimeout(() => shellCtrl.abort(), 12000);
      const shellPromise = fetch(
        `/api/admin/panelka?op=player-card&${keyQ}`,
        { cache: "no-store", signal: shellCtrl.signal }
      )
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            profile?: PlayerProfile;
            pb1Stats?: PlayerPb1Stats | null;
            nickHistory?: NickHistoryRow[];
            notes?: PlayerMemoRow[];
            labels?: PlayerMemoRow[];
            error?: string;
          } | null;
          if (!res.ok || !data?.ok) {
            if (!silent) {
              setLoadError(data?.error || `карточка не загрузилась (${res.status})`);
            }
            if (data?.profile) setProfile(data.profile);
            if (data?.pb1Stats) setPb1Stats(data.pb1Stats);
            if (data?.nickHistory) setNickHistory(data.nickHistory);
            if (data?.notes) setNotes(data.notes);
            if (data?.labels) setLabels(data.labels);
            return;
          }
          setProfile(data.profile || null);
          if (data.pb1Stats) setPb1Stats(data.pb1Stats);
          setNickHistory(data.nickHistory || []);
          setNotes(data.notes || []);
          setLabels(data.labels || []);
        })
        .catch((err: unknown) => {
          if (!silent) {
            const aborted =
              err instanceof DOMException && err.name === "AbortError";
            setLoadError(
              aborted ? "профиль долго отвечает" : "нет связи с сайтом"
            );
          }
        })
        .finally(() => {
          window.clearTimeout(shellTimer);
          if (!silent) setLoading(false);
        });

      // 3) Slow history: chat / bans / TK — does not block profile
      const histCtrl = new AbortController();
      const histTimer = window.setTimeout(() => histCtrl.abort(), 45000);
      void fetch(`/api/admin/panelka?op=player-history&${keyQ}`, {
        cache: "no-store",
        signal: histCtrl.signal,
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            chat?: ChatLine[];
            teamkills?: TeamKillRow[];
            punishments?: PunishmentRow[];
            warning?: string;
          } | null;
          if (!res.ok || !data?.ok) {
            if (!silent && data?.warning) setLoadError(data.warning);
            return;
          }
          setChat(data.chat || []);
          setTeamkills(data.teamkills || []);
          setPunishments(data.punishments || []);
          if (data.warning) setLoadError(data.warning);
        })
        .catch((err: unknown) => {
          if (!silent) {
            const aborted =
              err instanceof DOMException && err.name === "AbortError";
            setLoadError(
              aborted
                ? "история не успела — действия работают"
                : "история: нет связи"
            );
          }
        })
        .finally(() => {
          window.clearTimeout(histTimer);
          setHistoryLoading(false);
        });

      return shellPromise;
    },
    [serverKey, player.steamId, player.name]
  );

  useEffect(() => {
    setPending(null);
    setConfirmKick(false);
    setReason("");
    setBanUnit("d");
    setBanAmount("1");
    setWarnText("");
    setActionNotice("");
    setHasCamera(false);
    setTab("chat");
    setChatPage(0);
    setTkPage(0);
    setPunishPage(0);
    setNickHistory([]);
    setNotes([]);
    setLabels([]);
    setChat([]);
    setTeamkills([]);
    setPunishments([]);
    setPb1Stats(null);
    setVisitHover(null);
    setNoteDraft("");
    setLabelDraft("");
    setHistoryLoading(true);
    // Instant stub so header block is never empty
    setProfile({
      found: false,
      nick: null,
      steamId: player.steamId,
      profileUrl: `/players/${encodeURIComponent(player.steamId)}`,
      steamUrl: `https://steamcommunity.com/profiles/${encodeURIComponent(player.steamId)}`,
      faction: null,
      factionSlug: null,
      publicHoursLabel: "…",
      publicMinutes: 0,
      sessions: 0,
    });
    void loadCard();
  }, [loadCard, player.steamId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/admin/cameras?steamId=${encodeURIComponent(player.steamId)}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          cameras?: { steamId?: string }[];
          has?: boolean;
        } | null;
        if (cancelled) return;
        if (typeof data?.has === "boolean") {
          setHasCamera(data.has);
          return;
        }
        const hit = (data?.cameras || []).some((c) => c.steamId === player.steamId);
        setHasCamera(hit);
      })
      .catch(() => {
        if (!cancelled) setHasCamera(Boolean(player.rights === "camera"));
      });
    return () => {
      cancelled = true;
    };
  }, [player.steamId, player.rights]);

  async function postMemo(
    action: "note-add" | "label-add" | "memo-remove",
    extra: { message?: string; memoId?: string }
  ) {
    setMemoBusy(true);
    try {
      const res = await fetch("/api/admin/panelka", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: serverKey,
          steamId: player.steamId,
          action,
          ...extra,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        notes?: PlayerMemoRow[];
        labels?: PlayerMemoRow[];
      };
      if (!res.ok || !data.ok) {
        setLoadError(data.error || "не вышло");
        return false;
      }
      if (data.notes) setNotes(data.notes);
      if (data.labels) setLabels(data.labels);
      setLoadError("");
      return true;
    } catch {
      setLoadError("нет связи с сайтом");
      return false;
    } finally {
      setMemoBusy(false);
    }
  }

  const banDuration = useMemo(() => {
    if (banUnit === "0") return "0";
    const n = Number.parseInt(banAmount, 10);
    if (!Number.isFinite(n) || n < 1 || n > 9999) return "";
    return `${n}${banUnit}`;
  }, [banUnit, banAmount]);

  const chatPages = Math.max(1, Math.ceil(chat.length / PAGE));
  const tkPages = Math.max(1, Math.ceil(teamkills.length / PAGE));
  const punishPages = Math.max(1, Math.ceil(punishments.length / PAGE));
  const chatSlice = useMemo(() => {
    const start = chatPage * PAGE;
    return chat.slice(start, start + PAGE);
  }, [chat, chatPage]);
  const tkSlice = useMemo(() => {
    const start = tkPage * PAGE;
    return teamkills.slice(start, start + PAGE);
  }, [teamkills, tkPage]);
  const punishSlice = useMemo(() => {
    const start = punishPage * PAGE;
    return punishments.slice(start, start + PAGE);
  }, [punishments, punishPage]);
  const steamUrl =
    profile?.steamUrl || `https://steamcommunity.com/profiles/${player.steamId}`;

  async function runPending() {
    if (!pending || busy) return;
    if (pending === "team" || pending === "unsquad") {
      const ok = await onAction(pending, {});
      if (ok) {
        setPending(null);
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
      return;
    }
    if (pending === "camera") {
      setActionNotice("");
      const ok = await onAction("camera-add", {});
      if (ok) {
        setHasCamera(true);
        setActionNotice("Камера выдана и сохранена. Если игрок онлайн — freecam уже должен работать, иначе пусть перезайдёт.");
        setPending(null);
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      } else {
        setActionNotice("Не удалось выдать камеру — смотри красный статус сверху панели серверов.");
      }
      return;
    }
    if (pending === "warn") {
      const text = warnText.trim();
      if (!text) return;
      const ok = await onAction("warn", { reason: text, message: text });
      if (ok) {
        setPending(null);
        setWarnText("");
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
      return;
    }
    const why = reason.trim();
    if (why.length < 2) return;
    if (pending === "kick") {
      if (!confirmKick) {
        setConfirmKick(true);
        return;
      }
      const ok = await onAction("kick", { reason: why });
      if (ok) {
        setPending(null);
        setConfirmKick(false);
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
      return;
    }
    if (pending === "ban") {
      if (!banDuration) return;
      const ok = await onAction("ban", { reason: why, duration: banDuration });
      if (ok) {
        setPending(null);
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
    }
  }

  function primaryLabel(): string {
    if (pending === "camera") return "Да, выдать камеру";
    if (pending === "kick") return confirmKick ? "Да, кикнуть" : "Кикнуть";
    if (pending === "ban") return "Забанить";
    if (pending === "warn") return "Отправить";
    if (pending === "team") return "Перекинуть";
    if (pending === "unsquad") return "Выгнать";
    return "Сделать";
  }

  return (
    <div className="panelka-modal-bg" onClick={onClose} role="presentation">
      <div
        className="panelka-modal panelka-mod-card"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panelka-mod-head">
          <div className="panelka-mod-head-main">
            <h3>
              <a className="panelka-mod-steam" href={steamUrl} target="_blank" rel="noreferrer">
                {player.name}
              </a>
            </h3>
            <p className="panelka-mod-meta">
              {player.leader ? "СЛ · " : player.role ? `${player.role} · ` : ""}
              <a className="panelka-mod-steam-id" href={steamUrl} target="_blank" rel="noreferrer">
                {player.steamId}
              </a>
              {" · "}
              <a className="panelka-mod-link" href={steamUrl} target="_blank" rel="noreferrer">
                Steam
              </a>
            </p>
          </div>
          <div className="panelka-mod-labels" title="Ярлыки штаба">
            {labels.map((lab) => (
              <span key={lab.id} className="panelka-label-chip" title={`${lab.byNick} · ${formatNickSeen(lab.createdAt)}`}>
                {lab.text}
                <button
                  type="button"
                  className="panelka-label-x"
                  disabled={memoBusy}
                  aria-label={`снять ярлык ${lab.text}`}
                  onClick={() => void postMemo("memo-remove", { memoId: lab.id })}
                >
                  ×
                </button>
              </span>
            ))}
            {!labels.length ? <span className="panelka-label-empty">нет ярлыков</span> : null}
          </div>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="panelka-mod-profile">
          {loading && !pb1Stats ? (
            <p className="muted">Подгружаю профиль…</p>
          ) : null}
          {loadError ? <p className="panelka-notice">{loadError}</p> : null}
          {profile ? (
            <>
              <p>
                {profile.found ? (
                  <>
                    На сайте: <b>{profile.nick || "без ника"}</b>
                    {profile.faction ? <> · фракция {profile.faction}</> : null}
                  </>
                ) : (
                  <>На сайте не зарегистрирован</>
                )}
              </p>
              <p>
                Паблик:{" "}
                <b>{pb1Stats?.hoursLabel || profile.publicHoursLabel}</b>
                {(pb1Stats?.sessions ?? profile.sessions)
                  ? ` · ${pb1Stats?.sessions ?? profile.sessions} сессий`
                  : ""}
              </p>
              <p>
                Steam Squad:{" "}
                <b>
                  {pb1Stats?.steamHoursLabel
                    ? pb1Stats.steamHoursLabel
                    : pb1Stats?.steamPlayStatus === "private"
                      ? "скрыто"
                      : "—"}
                </b>
                {pb1Stats?.steam2WeeksLabel
                  ? ` · за 2 нед. ${pb1Stats.steam2WeeksLabel}`
                  : ""}
              </p>
              {pb1Stats?.location?.country || pb1Stats?.location?.offsetLabel ? (
                <p className="panelka-pb1-loc" title={pb1Stats.location.ip || undefined}>
                  Локация:{" "}
                  <b>
                    {[
                      pb1Stats.location.country,
                      pb1Stats.location.region,
                      pb1Stats.location.city,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </b>
                  {pb1Stats.location.offsetLabel
                    ? ` · (${pb1Stats.location.offsetLabel})`
                    : ""}
                </p>
              ) : pb1Stats && !loading ? (
                <p className="panelka-pb1-loc muted">Локация: нет IP в свежих логах</p>
              ) : null}
              <div className="panelka-mod-links">
                <a className="panelka-mod-link" href={steamUrl} target="_blank" rel="noreferrer">
                  Профиль Steam
                </a>
                <a className="panelka-mod-link" href={profile.profileUrl} target="_blank" rel="noreferrer">
                  Профиль на сайте
                </a>
              </div>
            </>
          ) : null}

          {pb1Stats ? (
            <div className="panelka-pb1-stats" aria-label="Статистика PB1 (только админка)">
              <div className="panelka-pb1-cards">
                <div className="panelka-pb1-card">
                  <span>Steam Squad</span>
                  <strong>
                    {pb1Stats.steamHoursLabel
                      ? pb1Stats.steamHoursLabel
                      : pb1Stats.steamPlayStatus === "private"
                        ? "скрыто"
                        : "—"}
                  </strong>
                  {pb1Stats.steam2WeeksLabel ? (
                    <em>2 нед. {pb1Stats.steam2WeeksLabel}</em>
                  ) : null}
                </div>
                <div className="panelka-pb1-card">
                  <span>Онлайн PB1</span>
                  <strong>{pb1Stats.hoursLabel}</strong>
                </div>
                <div className="panelka-pb1-card">
                  <span>Побед</span>
                  <strong>
                    {pb1Stats.winsPct != null ? `${pb1Stats.winsPct}%` : "—"}
                  </strong>
                  {pb1Stats.matches ? (
                    <em>{pb1Stats.matches} матчей</em>
                  ) : null}
                </div>
                <div className="panelka-pb1-card">
                  <span>Кит</span>
                  <strong>{pb1Stats.favoriteKit || "—"}</strong>
                </div>
                <div className="panelka-pb1-card">
                  <span>К/Д</span>
                  <strong>
                    {pb1Stats.kd != null ? pb1Stats.kd.toFixed(2) : "—"}
                  </strong>
                </div>
              </div>
              <div className="panelka-pb1-chart">
                <div className="panelka-pb1-chart-head">
                  <span>График заходов · 90 дней · PB1</span>
                  <span className="muted">
                    {pb1Stats.visitDays} дн. с онлайном
                  </span>
                </div>
                <div className="panelka-pb1-legend" aria-hidden>
                  <span className="is-online">Онлайн</span>
                  <span className="is-boost">Буст</span>
                  <span className="is-queue">Очередь</span>
                </div>
                <div
                  className="panelka-pb1-bars"
                  role="img"
                  aria-label="Минуты на PB1 по дням"
                >
                  {pb1Stats.visitBars.map((b) => {
                    const pct =
                      (b.hours / Math.max(pb1Stats.visitMaxHours, 0.25)) * 100;
                    const active = visitHover === b.ymd;
                    const onlineMin = Math.max(0, Math.round(b.minutes));
                    const boostMin = 0;
                    const queueMin = 0;
                    return (
                      <button
                        key={b.ymd}
                        type="button"
                        className={`panelka-pb1-bar${active ? " is-on" : ""}${b.hours > 0 ? "" : " is-empty"}`}
                        style={{
                          ["--h" as string]: `${Math.max(pct, b.hours > 0 ? 4 : 0)}%`,
                        }}
                        onMouseEnter={() => setVisitHover(b.ymd)}
                        onMouseLeave={() => setVisitHover(null)}
                        onFocus={() => setVisitHover(b.ymd)}
                        onBlur={() => setVisitHover(null)}
                      >
                        <span className="panelka-pb1-bar-stack">
                          <span className="panelka-pb1-bar-online" />
                        </span>
                        {active ? (
                          <span className="panelka-pb1-float" role="tooltip">
                            <strong className="panelka-pb1-float-date">
                              {b.ymd}
                            </strong>
                            <span className="panelka-pb1-float-row is-online">
                              Онлайн: {formatPlayDuration(onlineMin)}
                            </span>
                            <span className="panelka-pb1-float-row is-boost">
                              Буст: {formatPlayDuration(boostMin)}
                            </span>
                            <span className="panelka-pb1-float-row is-queue">
                              Очередь: {formatPlayDuration(queueMin)}
                            </span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {!visitHover ? (
                  <div className="panelka-pb1-tip muted">
                    Наведи на день — онлайн / буст / очередь
                  </div>
                ) : (
                  <div className="panelka-pb1-tip" aria-hidden>
                    {"\u00a0"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {nickHistory.length ? (
            <div className="panelka-nick-hist">
              <p className="panelka-nick-hist-title">История ников (сайт, не Steam)</p>
              <ul>
                {nickHistory.slice(0, 16).map((row) => (
                  <li key={`${row.nick}-${row.lastSeenAt}`}>
                    <b>{row.nick}</b>
                    <span>
                      {formatNickSeen(row.lastSeenAt)}
                      {row.seenCount > 1 ? ` · ×${row.seenCount}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : !loading ? (
            <p className="panelka-nick-hist-empty">История ников пока пуста — появится с заходов на сервер.</p>
          ) : null}

          <div className="panelka-memos">
            <div className="panelka-memo-block">
              <p className="panelka-nick-hist-title">Ярлык (до 3 слов)</p>
              <form
                className="panelka-memo-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = labelDraft.trim();
                  if (!text || memoBusy) return;
                  void postMemo("label-add", { message: text }).then((ok) => {
                    if (ok) setLabelDraft("");
                  });
                }}
              >
                <input
                  value={labelDraft}
                  maxLength={36}
                  disabled={memoBusy}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  placeholder="напр. токсик / афк фарм"
                />
                <button type="submit" disabled={memoBusy || !labelDraft.trim()}>
                  Повесить
                </button>
              </form>
            </div>
            <div className="panelka-memo-block">
              <p className="panelka-nick-hist-title">Заметки штаба</p>
              <form
                className="panelka-memo-form panelka-memo-form-note"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = noteDraft.trim();
                  if (text.length < 2 || memoBusy) return;
                  void postMemo("note-add", { message: text }).then((ok) => {
                    if (ok) setNoteDraft("");
                  });
                }}
              >
                <input
                  value={noteDraft}
                  maxLength={500}
                  disabled={memoBusy}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="текст заметки…"
                />
                <button type="submit" disabled={memoBusy || noteDraft.trim().length < 2}>
                  Записать
                </button>
              </form>
              {notes.length ? (
                <ul className="panelka-notes-list">
                  {notes.map((row) => (
                    <li key={row.id}>
                      <div>
                        <p>{row.text}</p>
                        <span>
                          {formatNickSeen(row.createdAt)} · {row.byNick}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={memoBusy}
                        onClick={() => void postMemo("memo-remove", { memoId: row.id })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panelka-nick-hist-empty">Заметок пока нет.</p>
              )}
            </div>
          </div>
        </div>

        <div className="panelka-mod-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setPending("team");
            }}
          >
            Перекинуть команду
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setPending("unsquad");
            }}
          >
            Выгнать с отряда
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setPending("warn");
            }}
          >
            Админ-сообщение
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setPending("kick");
            }}
          >
            Кикнуть
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setPending("ban");
            }}
          >
            Забанить
          </button>
        </div>

        {pending ? (
          <div className="panelka-mod-form">
            {pending === "team" ? <p>Перекинуть {player.name} в другую команду?</p> : null}
            {pending === "unsquad" ? <p>Выгнать {player.name} из текущего отряда?</p> : null}
            {pending === "camera" ? (
              <p>
                Точно выдать камеру <b>{player.name}</b>?
                <br />
                Запишем Cameraman в Admins.cfg и в постоянный лог (Sqstat больше не сотрёт).
              </p>
            ) : null}
            {pending === "warn" ? (
              <>
                <p>Сообщение игроку (видит только он):</p>
                <input
                  value={warnText}
                  maxLength={160}
                  onChange={(event) => setWarnText(event.target.value)}
                  placeholder="Предупреждение…"
                />
              </>
            ) : null}
            {pending === "kick" && confirmKick ? (
              <p>
                Точно кикнуть <b>{player.name}</b>?
                <br />
                Причина: <b>{reason.trim()}</b>
              </p>
            ) : null}
            {(pending === "kick" && !confirmKick) || pending === "ban" ? (
              <>
                <p>Укажи причину{pending === "ban" ? " и срок" : ""}:</p>
                <input
                  value={reason}
                  maxLength={120}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setConfirmKick(false);
                  }}
                  placeholder="Причина обязательна"
                />
                {pending === "ban" ? (
                  <div className="panelka-mod-ban-term">
                    <div className="panelka-mod-durs">
                      {BAN_UNITS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          className={banUnit === item.value ? "is-on" : ""}
                          onClick={() => setBanUnit(item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {banUnit !== "0" ? (
                      <label className="panelka-mod-ban-amount">
                        <span>Сколько</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={9999}
                          step={1}
                          value={banAmount}
                          onChange={(event) =>
                            setBanAmount(event.target.value.replace(/[^\d]/g, "").slice(0, 4))
                          }
                          placeholder="число"
                        />
                      </label>
                    ) : (
                      <p className="panelka-mod-ban-forever">Бан без срока.</p>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="panelka-mod-form-actions">
              <button
                type="button"
                disabled={
                  busy ||
                  (pending === "warn" && !warnText.trim()) ||
                  ((pending === "kick" || pending === "ban") && reason.trim().length < 2) ||
                  (pending === "ban" && !banDuration)
                }
                onClick={() => void runPending()}
              >
                {primaryLabel()}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (pending === "kick" && confirmKick) {
                    setConfirmKick(false);
                    return;
                  }
                  setPending(null);
                  setConfirmKick(false);
                }}
              >
                {pending === "kick" && confirmKick ? "Назад" : "Отмена"}
              </button>
            </div>
          </div>
        ) : null}

        {actionNotice ? (
          <p className="panelka-camera-notice">{actionNotice}</p>
        ) : null}

        <div className="panelka-mod-tabs">
          <button type="button" className={tab === "chat" ? "is-on" : ""} onClick={() => setTab("chat")}>
            Чат
          </button>
          <button
            type="button"
            className={tab === "punish" ? "is-on" : ""}
            onClick={() => setTab("punish")}
          >
            История наказаний
            {punishments.length ? ` (${punishments.length})` : ""}
          </button>
          <button type="button" className={tab === "tk" ? "is-on" : ""} onClick={() => setTab("tk")}>
            Тимкилы
            {teamkills.length ? ` (${teamkills.length})` : ""}
          </button>
          <button
            type="button"
            className={`panelka-camera-grant${hasCamera ? " is-done" : ""}`}
            disabled={busy}
            onClick={() => {
              setConfirmKick(false);
              setActionNotice("");
              setPending("camera");
            }}
          >
            {hasCamera ? "Камера есть / обновить" : "Выдать камеру"}
          </button>
        </div>

        {tab === "chat" ? (
          <div className="panelka-mod-punish">
            <header>
              <h4>Сообщения игрока и наказания в ленте</h4>
              <Pager page={chatPage} pages={chatPages} onChange={setChatPage} />
            </header>
            {chatSlice.length ? (
              <ul>
                {chatSlice.map((line, index) => (
                  <li key={`c-${chatPage}-${index}`}>
                    <span>
                      {[line.date, line.clock].filter(Boolean).join(" ") || "—"}
                      {line.channel ? ` · ${line.channel}` : ""}
                    </span>
                    <b>
                      {line.name ? `${line.name}: ` : ""}
                      {line.text}
                    </b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panelka-chat-empty">
                {historyLoading ? "Подгружаю чат…" : "Сообщений нет."}
              </p>
            )}
          </div>
        ) : null}

        {tab === "punish" ? (
          <div className="panelka-mod-punish">
            <header>
              <h4>Кик · бан · админ-сообщения · репорты · кто кого наказал</h4>
              <Pager page={punishPage} pages={punishPages} onChange={setPunishPage} />
            </header>
            {punishSlice.length ? (
              <ul>
                {punishSlice.map((row, index) => (
                  <li key={`p-${punishPage}-${index}`}>
                    <span>
                      {[row.date, row.clock].filter(Boolean).join(" ") || "—"}
                      {" · "}
                      {punishLabel(row.kind)}
                      {row.duration ? ` · срок ${row.duration}` : ""}
                    </span>
                    <b>
                      {row.kind === "kick" || row.kind === "ban"
                        ? `причина: ${stripActorPrefix(row.reason) || "не указана"}`
                        : stripActorPrefix(row.reason) || "—"}
                    </b>
                    <em>
                      кто: {row.by || "неизвестно"} → кого: {player.name}
                    </em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panelka-chat-empty">
                {historyLoading
                  ? "Подгружаю наказания…"
                  : "Наказаний и репортов пока нет."}
              </p>
            )}
          </div>
        ) : null}

        {tab === "tk" ? (
          <div className="panelka-mod-punish">
            <header>
              <h4>Тимкилы этого игрока</h4>
              <Pager page={tkPage} pages={tkPages} onChange={setTkPage} />
            </header>
            {tkSlice.length ? (
              <ul>
                {tkSlice.map((row, index) => (
                  <li key={`t-${tkPage}-${index}`}>
                    <span>{[row.date, row.clock].filter(Boolean).join(" ") || "—"}</span>
                    <b>убил своего: {row.victim}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panelka-chat-empty">
                {historyLoading ? "Подгружаю тимкилы…" : "Тимкилов в логе не видно."}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return <span>{pages ? "1/1" : "0"}</span>;
  return (
    <span className="panelka-pager">
      <button type="button" disabled={page <= 0} onClick={() => onChange(page - 1)}>
        ←
      </button>
      <span>
        {page + 1}/{pages}
      </span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>
        →
      </button>
    </span>
  );
}

/** 236 мин → «3ч 56м»; 12 → «12м»; 0 → «0с» */
function formatPlayDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m <= 0) return "0с";
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}ч ${mm}м` : `${h}ч`;
}

function formatNickSeen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function punishLabel(kind: string): string {
  if (kind === "kick") return "кик";
  if (kind === "ban") return "бан";
  if (kind === "warn") return "админ-сообщение";
  if (kind === "camera") return "камера";
  if (kind === "report") return "репорт игрока";
  if (kind === "team") return "смена команды";
  if (kind === "unsquad") return "выгон с отряда";
  return kind || "действие";
}

function stripActorPrefix(reason: string | undefined): string {
  return String(reason || "")
    .replace(/^\[[^\]]{1,32}\]\s*/, "")
    .trim();
}

function formatUnix(ts: number): string {
  if (!ts) return "—";
  const value = ts > 10_000_000_000 ? ts : ts * 1000;
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Сколько прошло после рестарта SquadGameServer. */
function formatUptimeSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `после рестарта ${days}д ${hours}ч`;
  if (hours > 0) return `после рестарта ${hours}ч ${mins}м`;
  if (mins > 0) return `после рестарта ${mins}м`;
  return `после рестарта ${s}с`;
}

function placeholderServers(): PanelkaServer[] {
  return ["TR1", "TR2", "TR3", "TR4", "TR5", "PB1"].map((key) => ({
    key,
    name: key,
    map: "нажми",
    layer: "",
    players: 0,
    maxPlayers: 100,
    queue: 0,
    error: null,
  }));
}

const PANELKA_PLACE_KEY = "panelka-place-v1";
const PANELKA_KEYS = new Set(["TR1", "TR2", "TR3", "TR4", "TR5", "PB1"]);

type PanelkaPlace = {
  selected: string;
  scrollY: number;
  mgmtOpen: boolean;
  modsOpen: boolean;
};

function readPanelkaPlace(): PanelkaPlace {
  const empty: PanelkaPlace = {
    selected: "",
    scrollY: 0,
    mgmtOpen: false,
    modsOpen: false,
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(PANELKA_PLACE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw) as Partial<PanelkaPlace>;
    const selected =
      typeof data.selected === "string" && PANELKA_KEYS.has(data.selected)
        ? data.selected
        : "";
    return {
      selected,
      scrollY: Math.max(0, Number(data.scrollY) || 0),
      mgmtOpen: Boolean(data.mgmtOpen),
      modsOpen: Boolean(data.modsOpen),
    };
  } catch {
    return empty;
  }
}

function writePanelkaPlace(place: PanelkaPlace) {
  try {
    localStorage.setItem(PANELKA_PLACE_KEY, JSON.stringify(place));
  } catch {
    /* ignore */
  }
}

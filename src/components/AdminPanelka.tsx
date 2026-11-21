"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelkaServer } from "@/lib/panelkaRcon";

const MODES = ["SQ", "FCL", "CSL", "SEC", "LOADER"] as const;
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
  rights?: "admin" | "moderator" | string;
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

type NickHistoryRow = {
  nick: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  source: string;
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

type ModAction = "team" | "kick" | "ban" | "unsquad" | "warn" | null;

type ServerMod = {
  id: string;
  title: string;
  localUpdated: number;
  steamUpdated: number;
  needsUpdate: boolean;
  inLoadOrder: boolean;
};

type AdminPanelkaProps = {
  backHref?: string;
  backLabel?: string;
};

export function AdminPanelka({
  backHref = "/admin",
  backLabel = "К админке",
}: AdminPanelkaProps = {}) {
  const [servers, setServers] = useState<PanelkaServer[]>(() => placeholderServers());
  const [loadedKeys, setLoadedKeys] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterOnce, setRosterOnce] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [modsOpen, setModsOpen] = useState(false);
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
      const res = await fetch(`/api/admin/panelka?op=roster&key=${key}`, { cache: "no-store" });
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
      setTeams(data.teams);
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
    const res = await fetch(`/api/admin/panelka?op=chat&key=${key}`, { cache: "no-store" });
    const data = (await res.json()) as { ok?: boolean; messages?: ChatLine[] };
    if (data.ok && data.messages) setChat(data.messages);
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
      setRosterOnce(false);
      return;
    }
    setRosterOnce(false);
    setTeams([]);
    let stop = false;
    const key = selected;
    const boot = async () => {
      // Parallel: status card + roster — don't block players behind status
      void refreshOne(key);
      await Promise.all([loadRoster(key), loadMods(key), loadChat(key)]);
      if (stop) return;
    };
    void boot();
    // Soft chat poll only for the opened server (file read, no RCON storm)
    const chatTimer = window.setInterval(() => {
      if (!stop) void loadChat(key);
    }, 15000);
    return () => {
      stop = true;
      window.clearInterval(chatTimer);
    };
  }, [selected, refreshOne, loadRoster, loadMods, loadChat]);

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
          if (action === "mod-install" || action === "mod-remove") {
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
    setSelected(key);
    window.setTimeout(() => {
      rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
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
                      {item === "SQ" ? "Ваниль SQ" : item}
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
              распустить.
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
  const rightsClass =
    player.rights === "admin" ? " is-admin" : player.rights === "moderator" ? " is-mod" : "";
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
  return (
    <button type="button" className={classes} title={player.steamId} onClick={() => onPick(player)}>
      <span className="panelka-role">{player.leader ? "СЛ" : player.role || "—"}</span>
      <span className="panelka-slot-main">
        <b>{player.name}</b>
        <span className="panelka-slot-flags">
          {player.rights === "admin" ? <em className="is-admin">админ</em> : null}
          {player.rights === "moderator" ? <em className="is-mod">мод</em> : null}
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
    action: "team" | "kick" | "ban" | "unsquad" | "warn",
    payload: { reason?: string; duration?: string; message?: string }
  ) => Promise<boolean>;
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [nickHistory, setNickHistory] = useState<NickHistoryRow[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [teamkills, setTeamkills] = useState<TeamKillRow[]>([]);
  const [punishments, setPunishments] = useState<PunishmentRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ModAction>(null);
  const [confirmKick, setConfirmKick] = useState(false);
  const [reason, setReason] = useState("");
  const [banUnit, setBanUnit] = useState<BanUnit>("d");
  const [banAmount, setBanAmount] = useState("1");
  const [warnText, setWarnText] = useState("");
  const [tab, setTab] = useState<"chat" | "punish" | "tk">("chat");
  const [chatPage, setChatPage] = useState(0);
  const [tkPage, setTkPage] = useState(0);
  const [punishPage, setPunishPage] = useState(0);

  const loadCard = useCallback(
    (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (!silent) {
        setLoading(true);
        setLoadError("");
      }
      const url =
        `/api/admin/panelka?op=player-card&key=${encodeURIComponent(serverKey)}` +
        `&steamId=${encodeURIComponent(player.steamId)}` +
        `&name=${encodeURIComponent(player.name)}`;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 45000);
      return fetch(url, { cache: "no-store", signal: ctrl.signal })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            profile?: PlayerProfile;
            nickHistory?: NickHistoryRow[];
            chat?: ChatLine[];
            teamkills?: TeamKillRow[];
            punishments?: PunishmentRow[];
            error?: string;
            warning?: string;
          } | null;
          if (!res.ok || !data?.ok) {
            if (!silent) {
              setLoadError(data?.error || `карточка не загрузилась (${res.status})`);
            }
            if (data?.profile) setProfile(data.profile);
            if (data?.nickHistory) setNickHistory(data.nickHistory);
            return;
          }
          setProfile(data.profile || null);
          setNickHistory(data.nickHistory || []);
          setChat(data.chat || []);
          setTeamkills(data.teamkills || []);
          setPunishments(data.punishments || []);
          setLoadError(data.warning || "");
        })
        .catch((err: unknown) => {
          if (!silent) {
            const aborted =
              err instanceof DOMException && err.name === "AbortError";
            setLoadError(
              aborted
                ? "сервер долго отвечает, история не успела — действия работают"
                : "нет связи с сайтом"
            );
          }
        })
        .finally(() => {
          window.clearTimeout(timer);
          if (!silent) setLoading(false);
        });
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
    setTab("chat");
    setChatPage(0);
    setTkPage(0);
    setPunishPage(0);
    setNickHistory([]);
    void loadCard();
  }, [loadCard]);

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
        <header>
          <div>
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
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="panelka-mod-profile">
          {loading ? <p>Читаю профиль и историю…</p> : null}
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
                Паблик: <b>{profile.publicHoursLabel}</b>
                {profile.sessions ? ` · ${profile.sessions} сессий` : ""}
              </p>
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
        </div>

        <div className="panelka-mod-actions">
          <button type="button" disabled={busy} onClick={() => setPending("team")}>
            Перекинуть команду
          </button>
          <button type="button" disabled={busy} onClick={() => setPending("unsquad")}>
            Выгнать с отряда
          </button>
          <button type="button" disabled={busy} onClick={() => setPending("warn")}>
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
              <p className="panelka-chat-empty">Сообщений нет.</p>
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
              <p className="panelka-chat-empty">Наказаний и репортов пока нет.</p>
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
              <p className="panelka-chat-empty">Тимкилов в логе не видно.</p>
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelkaServer } from "@/lib/panelkaRcon";

const MODES = ["SQ", "FCL", "CSL", "SEC", "LOADER"] as const;
const PAGE = 8;
const BAN_DURATIONS = [
  { value: "30m", label: "30 мин" },
  { value: "1h", label: "1 час" },
  { value: "6h", label: "6 часов" },
  { value: "1d", label: "1 день" },
  { value: "7d", label: "7 дней" },
  { value: "0", label: "навсегда" },
] as const;
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
  text: string;
};

type RosterPerson = {
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
  const [servers, setServers] = useState<PanelkaServer[]>([]);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
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

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/panelka?op=status", { cache: "no-store" });
    const data = (await res.json()) as { ok?: boolean; servers?: PanelkaServer[]; error?: string };
    if (!res.ok || !data.ok || !data.servers) {
      setLoadError(data.error || "не удалось прочитать серверы");
      return;
    }
    setLoadError("");
    setServers(data.servers);
    try {
      localStorage.setItem("panelka-status-v1", JSON.stringify(data.servers));
    } catch {
      /* ignore */
    }
  }, []);

  const loadRoster = useCallback(async (key: string, quiet = false) => {
    if (!quiet) setRosterBusy(true);
    try {
      const res = await fetch(`/api/admin/panelka?op=roster&key=${key}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; teams?: RosterTeam[]; error?: string };
      if (!data.ok || !data.teams) {
        if (!quiet) setNotice(data.error || "список игроков не пришёл");
        return;
      }
      setTeams(data.teams);
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem("panelka-status-v1");
      const saved = raw ? (JSON.parse(raw) as PanelkaServer[]) : null;
      if (Array.isArray(saved) && saved.length) setServers(saved);
    } catch {
      /* ignore */
    }
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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
      return;
    }
    let stop = false;
    const pullChat = async () => {
      const res = await fetch(`/api/admin/panelka?op=chat&key=${selected}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; messages?: ChatLine[] };
      if (!stop && data.ok && data.messages) setChat(data.messages);
    };
    const pullRoster = async () => {
      if (!stop) await loadRoster(selected, true);
    };
    void pullChat();
    void loadRoster(selected);
    void loadMods(selected);
    const chatTimer = window.setInterval(() => {
      void pullChat();
    }, 5000);
    const rosterTimer = window.setInterval(() => {
      void pullRoster();
    }, 12000);
    return () => {
      stop = true;
      window.clearInterval(chatTimer);
      window.clearInterval(rosterTimer);
    };
  }, [selected, loadRoster, loadMods]);

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
          void refresh();
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
        {(servers.length ? servers : placeholderServers()).map((server) => (
          <article
            key={server.key}
            className={`panelka-card${selected === server.key ? " is-on" : ""}`}
          >
            <button type="button" className="panelka-card-main" onClick={() => selectServer(server.key)}>
              <b>{server.name}</b>
              <span>{server.map || "карта неизвестна"}</span>
            </button>
            <button
              type="button"
              className="panelka-count"
              onClick={() => selectServer(server.key)}
              disabled={!servers.length}
            >
              {server.players} / {server.maxPlayers || 100}
            </button>
          </article>
        ))}
      </div>

      <section className="panelka-desk">
        <h2>Управление</h2>
        {current ? (
          <p className="panelka-picked">
            Выбран {current.key}: {current.name}
          </p>
        ) : (
          <p className="panelka-picked">Сначала нажми один из серверов сверху.</p>
        )}
        <div className="panelka-actions">
          <button type="button" disabled={!current || Boolean(busy)} onClick={() => void openMaps()}>
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
                    <select value={deck1} onChange={(e) => setDeck1(e.target.value)} disabled={!faction1}>
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
                    <select value={deck2} onChange={(e) => setDeck2(e.target.value)} disabled={!faction2}>
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
                  <button type="button" disabled={Boolean(busy)} onClick={() => changeLayer("change-now")}>
                    Сменить сейчас
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => changeLayer("change-next")}>
                    Сменить после конца раунда
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {current ? (
          <div className="panelka-mods">
            <div className="panelka-live-head">
              <h3>Моды {current.key}</h3>
              <button
                type="button"
                disabled={modsBusy || Boolean(busy)}
                onClick={() => void loadMods(current.key)}
              >
                {modsBusy ? "Читаю…" : "Обновить"}
              </button>
            </div>
            <p className="panelka-picked">
              ID или ссылка Steam Workshop. После установки/удаления нужен рестарт сервера.
            </p>
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
                        if (window.confirm(`Удалить мод ${mod.title} (${mod.id}) с ${current.key}?`)) {
                          void send("mod-remove", { mod: mod.id });
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </article>
                ))
              ) : (
                <p className="panelka-chat-empty">{modsBusy ? "Читаю моды…" : "Модов нет."}</p>
              )}
            </div>
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
              Слева команда 1, справа команда 2. Нажми игрока — профиль паблика и действия модератора.
            </p>
            <div className="panelka-roster">
              <TeamColumn
                team={teamA}
                side="a"
                emptyLabel="Команда 1 пуста"
                onPick={setModPlayer}
              />
              <TeamColumn
                team={teamB}
                side="b"
                emptyLabel="Команда 2 пуста"
                onPick={setModPlayer}
              />
            </div>
            {!teamA && !teamB && !rosterBusy ? (
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
              chat.map((line, index) => (
                <p key={`${line.clock}-${index}`}>
                  <span>{line.date ? `${line.date} ` : ""}{line.clock}</span>
                  <span>{line.channel}</span>
                  <b>{line.name}</b>
                  {line.text}
                </p>
              ))
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
              setModPlayer(null);
            }
            return ok;
          }}
        />
      ) : null}
    </div>
  );
}

function TeamColumn({
  team,
  side,
  emptyLabel,
  onPick,
}: {
  team: RosterTeam | null;
  side: "a" | "b";
  emptyLabel: string;
  onPick: (player: RosterPerson) => void;
}) {
  return (
    <section className={side === "a" ? "is-a" : "is-b"}>
      <header>
        <b>{team?.name || (side === "a" ? "Команда 1" : "Команда 2")}</b>
        <span>{team?.count ?? 0}</span>
        {team ? <span>{team.tickets} тикетов</span> : null}
      </header>
      {(team?.squads || []).map((squad) => (
        <div key={squad.id} className="panelka-squad">
          <div className="panelka-squad-head">
            <span>{squad.id}</span>
            <b>{squad.name}</b>
            <span>
              {squad.size}
              {squad.locked ? " · закрыт" : ""}
            </span>
          </div>
          {squad.players.map((player) => (
            <RosterRow key={`${player.steamId}-${player.id}`} player={player} onPick={onPick} />
          ))}
        </div>
      ))}
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

function PlayerModModal({
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
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [teamkills, setTeamkills] = useState<TeamKillRow[]>([]);
  const [punishments, setPunishments] = useState<PunishmentRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ModAction>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("1h");
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
      return fetch(url, { cache: "no-store" })
        .then((res) => res.json())
        .then(
          (data: {
            ok?: boolean;
            profile?: PlayerProfile;
            chat?: ChatLine[];
            teamkills?: TeamKillRow[];
            punishments?: PunishmentRow[];
            error?: string;
          }) => {
            if (!data.ok) {
              if (!silent) setLoadError(data.error || "карточка не загрузилась");
              return;
            }
            setProfile(data.profile || null);
            setChat(data.chat || []);
            setTeamkills(data.teamkills || []);
            setPunishments(data.punishments || []);
            setLoadError("");
          }
        )
        .catch(() => {
          if (!silent) setLoadError("нет связи с сайтом");
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [serverKey, player.steamId, player.name]
  );

  useEffect(() => {
    setPending(null);
    setReason("");
    setWarnText("");
    setTab("chat");
    setChatPage(0);
    setTkPage(0);
    setPunishPage(0);
    void loadCard();
  }, [loadCard]);

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
      const ok = await onAction("kick", { reason: why });
      if (ok) {
        setPending(null);
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
      return;
    }
    if (pending === "ban") {
      const ok = await onAction("ban", { reason: why, duration });
      if (ok) {
        setPending(null);
        setTab("punish");
        window.setTimeout(() => void loadCard({ silent: true }), 900);
      }
    }
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
          <button type="button" disabled={busy} onClick={() => setPending("kick")}>
            Кикнуть
          </button>
          <button type="button" disabled={busy} onClick={() => setPending("ban")}>
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
            {pending === "kick" || pending === "ban" ? (
              <>
                <p>Укажи причину{pending === "ban" ? " и срок" : ""}:</p>
                <input
                  value={reason}
                  maxLength={120}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Причина обязательна"
                />
                {pending === "ban" ? (
                  <div className="panelka-mod-durs">
                    {BAN_DURATIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={duration === item.value ? "is-on" : ""}
                        onClick={() => setDuration(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
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
                  ((pending === "kick" || pending === "ban") && reason.trim().length < 2)
                }
                onClick={() => void runPending()}
              >
                Сделать
              </button>
              <button type="button" disabled={busy} onClick={() => setPending(null)}>
                Отмена
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
                    <b>{stripActorPrefix(row.reason) || "—"}</b>
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

function punishLabel(kind: string): string {
  if (kind === "kick") return "кик";
  if (kind === "ban") return "бан";
  if (kind === "warn") return "админ-сообщение";
  if (kind === "report") return "репорт игрока";
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
    map: "читаю…",
    layer: "",
    players: 0,
    maxPlayers: 100,
    error: null,
  }));
}

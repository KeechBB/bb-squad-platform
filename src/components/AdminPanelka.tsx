"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelkaServer } from "@/lib/panelkaRcon";

const MODES = ["FCL", "CSL", "SEC", "LOADER"] as const;
const PAGE = 8;
const BAN_DURATIONS = [
  { value: "30m", label: "30 мин" },
  { value: "1h", label: "1 час" },
  { value: "6h", label: "6 часов" },
  { value: "1d", label: "1 день" },
  { value: "7d", label: "7 дней" },
  { value: "0", label: "навсегда" },
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

type ModAction = "team" | "kick" | "ban" | "unsquad" | "warn" | null;

export function AdminPanelka() {
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
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("Команды, готовность?");
  const [askSend, setAskSend] = useState(false);
  const [sentLine, setSentLine] = useState("");
  const [modPlayer, setModPlayer] = useState<RosterPerson | null>(null);
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
    if (!selected) {
      setChat([]);
      setTeams([]);
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
  }, [selected, loadRoster]);

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
    setMode("");
    setPickedLayer("");
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
          <p className="lead">TR1–TR5. Карта, рестарт и конец раунда. Доступ: ты, HR и зам.</p>
        </div>
        <a className="panelka-back" href="/admin">
          К админке
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
                  {item}
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
              <div className="panelka-confirm">
                <p>{pickedLayer}</p>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void send("change-now", { layer: pickedLayer })}
                >
                  Сменить сейчас
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void send("change-next", { layer: pickedLayer })}
                >
                  Сменить после конца раунда
                </button>
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
            const ok = await send(action, { steamId: modPlayer.steamId, ...payload });
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
  return (
    <button
      type="button"
      className={player.leader ? "panelka-slot is-lead is-click" : "panelka-slot is-click"}
      title={player.steamId}
      onClick={() => onPick(player)}
    >
      <span className="panelka-role">{player.leader ? "СЛ" : player.role || "—"}</span>
      <b>{player.name}</b>
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
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ModAction>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("1h");
  const [warnText, setWarnText] = useState("");
  const [chatPage, setChatPage] = useState(0);
  const [tkPage, setTkPage] = useState(0);

  useEffect(() => {
    let stop = false;
    setLoading(true);
    setLoadError("");
    setPending(null);
    setReason("");
    setWarnText("");
    setChatPage(0);
    setTkPage(0);
    const url =
      `/api/admin/panelka?op=player-card&key=${encodeURIComponent(serverKey)}` +
      `&steamId=${encodeURIComponent(player.steamId)}` +
      `&name=${encodeURIComponent(player.name)}`;
    void fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then(
        (data: {
          ok?: boolean;
          profile?: PlayerProfile;
          chat?: ChatLine[];
          teamkills?: TeamKillRow[];
          error?: string;
        }) => {
          if (stop) return;
          if (!data.ok) {
            setLoadError(data.error || "карточка не загрузилась");
            return;
          }
          setProfile(data.profile || null);
          setChat(data.chat || []);
          setTeamkills(data.teamkills || []);
        }
      )
      .catch(() => {
        if (!stop) setLoadError("нет связи с сайтом");
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [serverKey, player.steamId, player.name]);

  const chatPages = Math.max(1, Math.ceil(chat.length / PAGE));
  const tkPages = Math.max(1, Math.ceil(teamkills.length / PAGE));
  const chatSlice = useMemo(() => {
    const start = chatPage * PAGE;
    return chat.slice(start, start + PAGE);
  }, [chat, chatPage]);
  const tkSlice = useMemo(() => {
    const start = tkPage * PAGE;
    return teamkills.slice(start, start + PAGE);
  }, [teamkills, tkPage]);

  async function runPending() {
    if (!pending || busy) return;
    if (pending === "team" || pending === "unsquad") {
      const ok = await onAction(pending, {});
      if (ok) setPending(null);
      return;
    }
    if (pending === "warn") {
      const text = warnText.trim();
      if (!text) return;
      const ok = await onAction("warn", { reason: text, message: text });
      if (ok) {
        setPending(null);
        setWarnText("");
      }
      return;
    }
    const why = reason.trim();
    if (why.length < 2) return;
    if (pending === "kick") {
      const ok = await onAction("kick", { reason: why });
      if (ok) setPending(null);
      return;
    }
    if (pending === "ban") {
      const ok = await onAction("ban", { reason: why, duration });
      if (ok) setPending(null);
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
            <h3>{player.name}</h3>
            <p className="panelka-mod-meta">
              {player.leader ? "СЛ · " : player.role ? `${player.role} · ` : ""}
              {player.steamId}
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
              <a className="panelka-mod-link" href={profile.profileUrl} target="_blank" rel="noreferrer">
                Открыть профиль на сайте
              </a>
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

        <div className="panelka-mod-hist">
          <section>
            <header>
              <h4>История чата</h4>
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
                    <b>{line.text}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panelka-chat-empty">Сообщений нет.</p>
            )}
          </section>
          <section>
            <header>
              <h4>История тимкилов</h4>
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
          </section>
        </div>
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

function placeholderServers(): PanelkaServer[] {
  return ["TR1", "TR2", "TR3", "TR4", "TR5"].map((key) => ({
    key,
    name: key,
    map: "читаю…",
    layer: "",
    players: 0,
    maxPlayers: 100,
    error: null,
  }));
}

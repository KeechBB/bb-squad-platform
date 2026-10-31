"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelkaServer } from "@/lib/panelkaRcon";

const MODES = ["FCL", "CSL", "SEC"] as const;

type ChatLine = {
  clock: string;
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

export function AdminPanelka() {
  const [servers, setServers] = useState<PanelkaServer[]>([]);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [playersFor, setPlayersFor] = useState<string | null>(null);
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const [mode, setMode] = useState<ModeName | "">("");
  const [layers, setLayers] = useState<Record<string, string[]> | null>(null);
  const [pickedLayer, setPickedLayer] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("Команды, готовность?");
  const [askSend, setAskSend] = useState(false);
  const [sentLine, setSentLine] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

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
    if (!selected) {
      setChat([]);
      return;
    }
    let stop = false;
    const pull = async () => {
      const res = await fetch(`/api/admin/panelka?op=chat&key=${selected}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; messages?: ChatLine[] };
      if (!stop && data.ok && data.messages) setChat(data.messages);
    };
    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [selected]);

  useEffect(() => {
    const node = chatRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat]);

  const current = servers.find((server) => server.key === selected) || null;

  async function send(action: string, extra: { layer?: string; steamId?: string; message?: string }) {
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
        window.setTimeout(() => void refresh(), 1200);
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

  async function openPlayers(key: string) {
    setSelected(key);
    setPlayersFor(key);
    setTeams([]);
    setBusy("players");
    try {
      const res = await fetch(`/api/admin/panelka?op=roster&key=${key}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; teams?: RosterTeam[]; error?: string };
      if (!data.ok || !data.teams) {
        setNotice(data.error || "список игроков не пришёл");
        setPlayersFor(null);
        return;
      }
      setTeams(data.teams);
    } finally {
      setBusy("");
    }
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

  async function playerAction(action: "kick" | "team", player: RosterPerson) {
    const verb = action === "kick" ? "кикнуть" : "сменить команду";
    if (!window.confirm(`${verb}: ${player.name}?`)) return;
    await send(action, { steamId: player.steamId });
    if (playersFor) void openPlayers(playersFor);
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
            <button type="button" className="panelka-card-main" onClick={() => setSelected(server.key)}>
              <b>{server.name}</b>
              <span>{server.map || "карта неизвестна"}</span>
            </button>
            <button
              type="button"
              className="panelka-count"
              onClick={() => void openPlayers(server.key)}
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
                  <span>{line.clock}</span>
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

      {playersFor ? (
        <div className="panelka-modal-bg" onClick={() => setPlayersFor(null)} role="presentation">
          <div
            className="panelka-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Игроки {playersFor}</h3>
              <button type="button" onClick={() => setPlayersFor(null)}>
                Закрыть
              </button>
            </header>
            <div className="panelka-roster">
              {teams.map((team) => (
                <section key={team.id} className={team.id === "1" ? "is-a" : "is-b"}>
                  <header>
                    <b>{team.name}</b>
                    <span>{team.count}</span>
                    <span>{team.tickets} тикетов</span>
                  </header>
                  {team.squads.map((squad) => (
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
                        <RosterRow
                          key={`${player.steamId}-${player.id}`}
                          player={player}
                          busy={Boolean(busy)}
                          onAction={(action) => void playerAction(action, player)}
                        />
                      ))}
                    </div>
                  ))}
                  {team.loose.length ? (
                    <div className="panelka-squad">
                      <div className="panelka-squad-head">
                        <b>Без сквада</b>
                        <span>{team.loose.length}</span>
                      </div>
                      {team.loose.map((player) => (
                        <RosterRow
                          key={`${player.steamId}-${player.id}`}
                          player={player}
                          busy={Boolean(busy)}
                          onAction={(action) => void playerAction(action, player)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
              {!teams.length ? <p className="panelka-chat-empty">На сервере никого нет.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RosterRow({
  player,
  busy,
  onAction,
}: {
  player: RosterPerson;
  busy: boolean;
  onAction: (action: "kick" | "team") => void;
}) {
  return (
    <div className={player.leader ? "panelka-slot is-lead" : "panelka-slot"} title={player.steamId}>
      <span className="panelka-role">{player.leader ? "СЛ" : player.role || "—"}</span>
      <b>{player.name}</b>
      <button type="button" disabled={busy} onClick={() => onAction("team")}>
        команда
      </button>
      <button type="button" disabled={busy} onClick={() => onAction("kick")}>
        кик
      </button>
    </div>
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

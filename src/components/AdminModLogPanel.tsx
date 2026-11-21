"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PlayerModModal,
  type RosterPerson,
} from "@/components/AdminPanelka";
import "@/app/admin/panelka/panelka.css";

type StaffLogEntry = {
  id: string;
  kind: string;
  date: string;
  clock: string;
  key: string;
  steamId: string;
  name: string;
  reason: string;
  duration?: string;
  byNick: string;
  bySteamId?: string;
};

const KIND_LABEL: Record<string, string> = {
  kick: "Кик",
  ban: "Бан",
  warn: "Админ-сообщение",
  team: "Смена команды",
  unsquad: "Выгон с отряда",
  disband: "Роспуск отряда",
  rename: "Сброс имени отряда",
  report: "Репорт",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || kind || "действие";
}

export function AdminModLogPanel() {
  const [entries, setEntries] = useState<StaffLogEntry[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [kind, setKind] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{
    serverKey: string;
    player: RosterPerson;
  } | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await fetch("/api/admin/panelka?op=staff-log&limit=500", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        entries?: StaffLogEntry[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "не удалось загрузить лог");
      }
      setEntries(data.entries || []);
    } catch (e) {
      if (!opts?.silent) {
        setErr(e instanceof Error ? e.message : "ошибка");
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load({ silent: true }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = qApplied.trim().toLowerCase();
    return entries.filter((row) => {
      if (kind && row.kind !== kind) return false;
      if (!needle) return true;
      const blob = [
        row.name,
        row.byNick,
        row.reason,
        row.key,
        row.steamId,
        kindLabel(row.kind),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [entries, kind, qApplied]);

  function applySearch(e: FormEvent) {
    e.preventDefault();
    setQApplied(q.trim());
  }

  function openCard(row: StaffLogEntry) {
    if (!row.steamId || !row.key) return;
    setCard({
      serverKey: row.key,
      player: {
        id: 0,
        name: row.name || row.steamId,
        steamId: row.steamId,
        leader: false,
        role: "",
      },
    });
  }

  async function onCardAction(
    action: "team" | "kick" | "ban" | "unsquad" | "warn",
    payload: { reason?: string; duration?: string; message?: string }
  ): Promise<boolean> {
    if (!card) return false;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/panelka", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: card.serverKey,
          action,
          steamId: card.player.steamId,
          targetName: card.player.name,
          reason: payload.reason || payload.message || "",
          duration: payload.duration || "",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      const ok = Boolean(res.ok && data.ok);
      if (ok) window.setTimeout(() => void load({ silent: true }), 900);
      return ok;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card journal-card">
      <form className="journal-toolbar" onSubmit={applySearch}>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <span>Поиск</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ник игрока, админ, причина, сервер…"
            autoComplete="off"
          />
        </label>
        <div className="attend-mode-toggle" role="group" aria-label="Тип">
          {(
            [
              ["", "Все"],
              ["kick", "Кик"],
              ["ban", "Бан"],
              ["warn", "Сообщение"],
              ["team", "Команда"],
              ["unsquad", "Выгон"],
              ["disband", "Роспуск"],
              ["rename", "Имя"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              className={kind === value ? "active" : ""}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? "…" : "Найти"}
        </button>
      </form>

      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}

      <div className="journal-window">
        <div className="journal-window-head">
          <span>Лог администраторов и модераторов</span>
          <span className="muted">
            {filtered.length ? `${filtered.length} записей` : "пусто"}
            {qApplied ? ` · «${qApplied}»` : ""}
          </span>
        </div>
        <div className="journal-chat" role="log" aria-live="polite">
          {!loading && filtered.length === 0 ? (
            <p className="journal-empty muted">
              Пока нет действий с панели серверов. Кик, бан, варн, смена команды и
              выгон с отряда появятся здесь.
            </p>
          ) : null}
          {filtered.map((row) => (
            <article
              key={row.id}
              className={`journal-msg journal-msg-cat-admin`}
            >
              <header className="journal-msg-meta">
                <time>
                  {[row.date, row.clock].filter(Boolean).join(" ") || "—"}
                </time>
                <span className="journal-msg-badge">{kindLabel(row.kind)}</span>
                {row.key ? (
                  <span className="journal-msg-tag">{row.key}</span>
                ) : null}
                {row.duration ? (
                  <span className="journal-msg-tag">срок {row.duration}</span>
                ) : null}
              </header>
              <p className="journal-msg-body">
                <b>{row.byNick || "панель"}</b>
                {" → "}
                {row.steamId ? (
                  <button
                    type="button"
                    className="mod-log-nick"
                    onClick={() => openCard(row)}
                    title="Открыть карточку игрока"
                  >
                    {row.name || row.steamId}
                  </button>
                ) : (
                  <b>{row.name || "—"}</b>
                )}
                {row.reason ? (
                  <>
                    {": "}
                    <span>{row.reason}</span>
                  </>
                ) : row.kind === "kick" || row.kind === "ban" ? (
                  <>: <span>причина не указана</span></>
                ) : null}
              </p>
            </article>
          ))}
        </div>
      </div>

      {card ? (
        <PlayerModModal
          serverKey={card.serverKey}
          player={card.player}
          busy={busy}
          onClose={() => setCard(null)}
          onAction={onCardAction}
        />
      ) : null}
    </section>
  );
}

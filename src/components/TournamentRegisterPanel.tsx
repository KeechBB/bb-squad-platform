"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIVE_TOURNAMENT,
  TOURNAMENT_ENTRY_MAX,
  TOURNAMENT_ENTRY_STARTERS,
  TOURNAMENT_ENTRY_SUBS,
} from "@/lib/tournaments";

type Member = { userId: string; nick: string; role: string };
type EntryPlayer = { userId: string; nick: string; slot: "STARTER" | "SUB" };

type EntriesPayload = {
  registrationOpen: boolean;
  canWithdraw: boolean;
  myRole: string | null;
  myTeam: { id: string; name: string; tag: string; members: Member[] } | null;
  myEntry: {
    id: string;
    createdAt: string;
    players: EntryPlayer[];
  } | null;
  entries: { id: string; team: { tag: string; name: string } }[];
};

type PickSlot = "none" | "starter" | "sub";

export function TournamentRegisterPanel() {
  const [data, setData] = useState<EntriesPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picks, setPicks] = useState<Record<string, PickSlot>>({});

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/tournaments/entries", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as EntriesPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Не удалось загрузить");
        return;
      }
      setData(json);
      setError("");
    } catch {
      setError("Сеть недоступна");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const starters = useMemo(
    () => Object.entries(picks).filter(([, s]) => s === "starter").map(([id]) => id),
    [picks]
  );
  const subs = useMemo(
    () => Object.entries(picks).filter(([, s]) => s === "sub").map(([id]) => id),
    [picks]
  );

  function openPicker() {
    if (!data?.myTeam) return;
    const init: Record<string, PickSlot> = {};
    for (const m of data.myTeam.members) init[m.userId] = "none";
    // captain default as starter if in list
    const cap = data.myTeam.members.find((m) => m.role === "CAPTAIN");
    if (cap) init[cap.userId] = "starter";
    setPicks(init);
    setPickerOpen(true);
    setError("");
  }

  function setSlot(userId: string, slot: PickSlot) {
    setPicks((prev) => {
      const next = { ...prev };
      if (slot === "starter") {
        const cur = Object.values(next).filter((s) => s === "starter").length;
        if (prev[userId] !== "starter" && cur >= TOURNAMENT_ENTRY_STARTERS) {
          setError(`Основных уже ${TOURNAMENT_ENTRY_STARTERS}`);
          return prev;
        }
      }
      if (slot === "sub") {
        const cur = Object.values(next).filter((s) => s === "sub").length;
        if (prev[userId] !== "sub" && cur >= TOURNAMENT_ENTRY_SUBS) {
          setError(`Замен уже ${TOURNAMENT_ENTRY_SUBS}`);
          return prev;
        }
      }
      setError("");
      next[userId] = slot;
      return next;
    });
  }

  async function submit() {
    if (starters.length !== TOURNAMENT_ENTRY_STARTERS) {
      setError(`Выбери ровно ${TOURNAMENT_ENTRY_STARTERS} основных`);
      return;
    }
    if (subs.length > TOURNAMENT_ENTRY_SUBS) {
      setError(`Замен не больше ${TOURNAMENT_ENTRY_SUBS}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tournaments/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starterIds: starters, subIds: subs }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Заявка отклонена");
        return;
      }
      setPickerOpen(false);
      await reload();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Отменить регистрацию команды на турнир?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tournaments/entries", { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Не удалось отменить");
        return;
      }
      await reload();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  const t = ACTIVE_TOURNAMENT;
  const canManageEntry =
    data?.myRole === "CAPTAIN" || data?.myRole === "DEPUTY";
  const registered = Boolean(data?.myEntry);

  return (
    <section className="tn-panel tn-register" aria-label="Регистрация команды">
      <h2 className="tn-panel-title">Регистрация команды на турнир</h2>
      <p className="tn-reg-dates">
        Окно: {t.regOpenDate.slice(8, 10)}.{t.regOpenDate.slice(5, 7)}.
        {t.regOpenDate.slice(2, 4)} — {t.regCloseDate.slice(8, 10)}.
        {t.regCloseDate.slice(5, 7)}.{t.regCloseDate.slice(2, 4)} · отказ до{" "}
        {t.withdrawUntilDate.slice(8, 10)}.{t.withdrawUntilDate.slice(5, 7)}.
        {t.withdrawUntilDate.slice(2, 4)} · в заявке {TOURNAMENT_ENTRY_STARTERS}+
        {TOURNAMENT_ENTRY_SUBS} (макс. {TOURNAMENT_ENTRY_MAX})
      </p>

      {!data ? (
        <p className="tn-placeholder">Загрузка…</p>
      ) : registered ? (
        <div className="tn-reg-status is-ok">
          <p>
            Ваша команда <strong>[{data.myTeam?.tag}] {data.myTeam?.name}</strong>{" "}
            зарегистрирована на турнире.
          </p>
          <p className="tn-reg-roster">
            Состав заявки:{" "}
            {data.myEntry!.players
              .map(
                (p) =>
                  `${p.nick}${p.slot === "SUB" ? " (зам.)" : ""}`
              )
              .join(", ")}
          </p>
          {canManageEntry && data.canWithdraw ? (
            <button
              type="button"
              className="tn-register-btn is-danger"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Отменить регистрацию
            </button>
          ) : (
            <p className="tn-placeholder">
              {canManageEntry
                ? "Срок отмены истёк или регистрация закрыта."
                : "Отменить могут капитан или зам в срок регистрации."}
            </p>
          )}
        </div>
      ) : !data.myTeam ? (
        <p className="tn-placeholder">
          Сначала создай турнирную команду во вкладке «Команды». Заявку подаёт
          капитан или зам.
        </p>
      ) : !data.registrationOpen ? (
        <p className="tn-placeholder">Регистрация сейчас закрыта.</p>
      ) : !canManageEntry ? (
        <p className="tn-placeholder">
          Команда [{data.myTeam.tag}] ещё не в сетке. Заявку подаёт капитан или
          зам.
        </p>
      ) : !pickerOpen ? (
        <>
          <p className="tn-placeholder">
            Выбери {TOURNAMENT_ENTRY_STARTERS} основных и до{" "}
            {TOURNAMENT_ENTRY_SUBS} замен из состава [{data.myTeam.tag}].
          </p>
          <button
            type="button"
            className="tn-register-btn"
            onClick={openPicker}
          >
            Регистрация
          </button>
        </>
      ) : (
        <div className="tn-reg-picker">
          <div className="tn-reg-counts">
            Основные: {starters.length}/{TOURNAMENT_ENTRY_STARTERS} · Замены:{" "}
            {subs.length}/{TOURNAMENT_ENTRY_SUBS}
          </div>
          <ul className="tn-reg-pick-list">
            {data.myTeam.members.map((m) => {
              const slot = picks[m.userId] || "none";
              return (
                <li key={m.userId} className="tn-reg-pick-row">
                  <span className="tn-reg-pick-nick">{m.nick}</span>
                  <div className="tn-reg-pick-actions">
                    <button
                      type="button"
                      className={slot === "starter" ? "is-on" : ""}
                      disabled={
                        busy ||
                        (slot !== "starter" &&
                          starters.length >= TOURNAMENT_ENTRY_STARTERS)
                      }
                      onClick={() =>
                        setSlot(
                          m.userId,
                          slot === "starter" ? "none" : "starter"
                        )
                      }
                    >
                      {slot === "starter" ? "Основной ✓" : "В основной"}
                    </button>
                    <button
                      type="button"
                      className={slot === "sub" ? "is-on" : ""}
                      disabled={
                        busy ||
                        (slot !== "sub" && subs.length >= TOURNAMENT_ENTRY_SUBS)
                      }
                      onClick={() =>
                        setSlot(m.userId, slot === "sub" ? "none" : "sub")
                      }
                    >
                      {slot === "sub" ? "Замена ✓" : "В замену"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="tn-reg-picker-actions">
            <button
              type="button"
              className="tn-register-btn"
              disabled={busy || starters.length !== TOURNAMENT_ENTRY_STARTERS}
              onClick={() => void submit()}
            >
              Отправить заявку
            </button>
            <button
              type="button"
              className="tn-teams-cancel-btn"
              disabled={busy}
              onClick={() => setPickerOpen(false)}
            >
              Назад
            </button>
          </div>
        </div>
      )}

      {error ? <p className="tn-teams-error">{error}</p> : null}

      {data && data.entries.length > 0 ? (
        <p className="tn-reg-bracket-note">
          В сетке уже:{" "}
          {data.entries.map((e) => `[${e.team.tag}]`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

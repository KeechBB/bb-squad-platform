"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CW_FORMATS,
  CW_MODE_IMAGE_V,
  CW_MODES,
  formatLabel,
  modeLabel,
  type CwFormat,
} from "@/lib/cwChallenge";

type SquadOpt = { id: string; name: string };

type ChallengeRow = {
  id: string;
  mode: string;
  format: number;
  scheduledAt: string;
  createdAt?: string;
  assignedServer: string | null;
  status: string;
  challenger: { id: string; tag: string; name: string; logoUrl: string | null };
  acceptor: { id: string; tag: string; name: string; logoUrl: string | null } | null;
  acceptorStack?: string | null;
  createdByNick: string | null;
};

type Props = {
  /** Если задан — форма создания только когда это твой клан. Без него — standalone (Поиск КВ). */
  clanId?: string | null;
  canManage?: boolean;
};

function fmtMsk(iso: string) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function modeMeta(mode: string) {
  return (
    CW_MODES.find((m) => m.id === mode) || {
      id: mode,
      label: modeLabel(mode),
      image: "",
    }
  );
}

function statusLabel(status: string) {
  if (status === "OPEN") return "Открыта";
  if (status === "ACCEPTED") return "Принята";
  return status;
}

export function ClanCwRegistrationPanel({
  clanId = null,
  canManage: canManageProp = true,
}: Props) {
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [myClanId, setMyClanId] = useState<string | null>(null);
  const [mySquads, setMySquads] = useState<SquadOpt[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<string>(CW_MODES[0].id);
  const [format, setFormat] = useState<CwFormat>(20);
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [brokenModeImg, setBrokenModeImg] = useState<Record<string, boolean>>(
    {}
  );
  const [acceptPick, setAcceptPick] = useState<{
    challengeId: string;
    squadId: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/cw-challenges", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки");
        return;
      }
      setRows(data.challenges || []);
      setMyClanId(data.myClanId || null);
      setMySquads(
        Array.isArray(data.mySquads)
          ? (data.mySquads as SquadOpt[]).filter((s) => s?.id && s?.name)
          : []
      );
      setCanCreate(Boolean(data.canManage));
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!(canManageProp && canCreate && myClanId)) return;
    if (!mode) {
      setError("Выбери мод");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cw-challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          format: Number(format),
          scheduledAt: scheduledLocal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось создать");
        return;
      }
      setShowForm(false);
      await load();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function postAccept(id: string, squadId?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cw-challenges/${id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(squadId ? { squadId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needSquad && Array.isArray(data.squads) && data.squads.length) {
          setMySquads(data.squads);
          setAcceptPick({
            challengeId: id,
            squadId: String(data.squads[0].id || ""),
          });
          return;
        }
        setError(data.error || "Не удалось принять");
        return;
      }
      setAcceptPick(null);
      await load();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function acceptChallenge(id: string) {
    if (!(canManageProp && canCreate && myClanId)) return;
    if (mySquads.length >= 2) {
      setAcceptPick({
        challengeId: id,
        squadId: mySquads[0].id,
      });
      setError("");
      return;
    }
    await postAccept(id);
  }

  async function confirmAcceptWithSquad() {
    if (!acceptPick?.challengeId || !acceptPick.squadId) return;
    await postAccept(acceptPick.challengeId, acceptPick.squadId);
  }

  async function cancelChallenge(id: string) {
    if (!(canManageProp && canCreate && myClanId)) return;
    if (!window.confirm("Отменить эту заявку?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cw-challenges/${id}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Не удалось отменить");
        return;
      }
      await load();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  const canManage = canManageProp && canCreate;
  const canOfferCreate =
    canManage && Boolean(myClanId) && (clanId == null || myClanId === clanId);

  return (
    <section className="card cw-find-card">
      <div className="cw-find-head">
        <div>
          <h3 className="stats-h3" style={{ marginTop: 0, marginBottom: 4 }}>
            Поиск КВ
          </h3>
        </div>
        {canOfferCreate ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Скрыть форму" : "Создать заявку на КВ"}
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Создавать и принимать заявки могут только глава или заместитель
          главы своего клана.
        </p>
      ) : null}

      {showForm && canOfferCreate ? (
        <form className="form cw-find-form" onSubmit={createChallenge}>
          <div className="field">
            <span>Мод</span>
            <div className="cw-mode-grid" role="listbox" aria-label="Мод КВ">
              {CW_MODES.map((m) => {
                const selected = mode === m.id;
                const broken = brokenModeImg[m.id];
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={m.label}
                    className={`cw-mode-card${selected ? " is-selected" : ""}`}
                    onClick={() => setMode(m.id)}
                    disabled={busy}
                  >
                    <span className="cw-mode-card-media" aria-hidden>
                      {!broken ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${m.image}?v=${CW_MODE_IMAGE_V}`}
                          alt=""
                          draggable={false}
                          onError={() =>
                            setBrokenModeImg((prev) => ({
                              ...prev,
                              [m.id]: true,
                            }))
                          }
                        />
                      ) : (
                        <span className="cw-mode-card-fallback">{m.label}</span>
                      )}
                    </span>
                    <span className="cw-mode-card-label">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <span>Формат</span>
            <div className="cw-format-grid" role="listbox" aria-label="Формат">
              {CW_FORMATS.map((f) => {
                const selected = format === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`cw-format-chip${selected ? " is-selected" : ""}`}
                    onClick={() => setFormat(f)}
                    disabled={busy}
                  >
                    {formatLabel(f)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="field">
            <span>Дата и время (МСК)</span>
            <input
              className="cw-find-datetime"
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              required
            />
          </label>

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Создаём…" : "Опубликовать заявку"}
          </button>
        </form>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Загрузка…</p> : null}

      {!loading ? (
        <div className="cw-challenge-list" aria-label="Заявки на КВ">
          {rows.length === 0 ? (
            <p className="muted cw-challenge-empty">Заявок пока нет.</p>
          ) : (
            rows.map((r) => {
              const isMine = r.challenger.id === myClanId;
              const canAccept =
                canManage &&
                r.status === "OPEN" &&
                !isMine &&
                myClanId != null;
              const canCancel = canManage && r.status === "OPEN" && isMine;
              const meta = modeMeta(r.mode);
              const imgBroken = brokenModeImg[`row-${r.id}`] || !meta.image;
              return (
                <article
                  key={r.id}
                  className={`cw-challenge-card${isMine ? " is-mine" : ""}${
                    r.status === "ACCEPTED" ? " is-accepted" : ""
                  }`}
                >
                  <div className="cw-challenge-mode" aria-label={meta.label}>
                    {!imgBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${meta.image}?v=${CW_MODE_IMAGE_V}`}
                        alt={meta.label}
                        draggable={false}
                        onError={() =>
                          setBrokenModeImg((prev) => ({
                            ...prev,
                            [`row-${r.id}`]: true,
                          }))
                        }
                      />
                    ) : (
                      <span className="cw-challenge-mode-fallback">
                        {meta.label}
                      </span>
                    )}
                    <span className="cw-challenge-mode-name">{meta.label}</span>
                  </div>

                  <div className="cw-challenge-body">
                    <div className="cw-challenge-top">
                      <span
                        className={`cw-challenge-status status-${r.status.toLowerCase()}`}
                      >
                        {statusLabel(r.status)}
                      </span>
                      <h4 className="cw-challenge-clan">
                        [{r.challenger.tag}] {r.challenger.name}
                        {r.acceptor ? (
                          <span className="cw-challenge-vs">
                            {" "}
                            vs [{r.acceptor.tag}] {r.acceptor.name}
                          </span>
                        ) : null}
                      </h4>
                    </div>

                    <dl className="cw-challenge-meta">
                      <div>
                        <dt>Создал</dt>
                        <dd>{r.createdByNick || "—"}</dd>
                      </div>
                      <div>
                        <dt>Создана</dt>
                        <dd>{fmtMsk(r.createdAt || "")}</dd>
                      </div>
                      <div>
                        <dt>Формат</dt>
                        <dd>{formatLabel(r.format)}</dd>
                      </div>
                      <div>
                        <dt>Матч (МСК)</dt>
                        <dd>{fmtMsk(r.scheduledAt)}</dd>
                      </div>
                      <div>
                        <dt>Сервер</dt>
                        <dd>
                          {r.assignedServer || (
                            <span className="muted">после матчмейкинга</span>
                          )}
                        </dd>
                      </div>
                      {r.status === "ACCEPTED" && r.acceptorStack ? (
                        <div>
                          <dt>Состав</dt>
                          <dd>{r.acceptorStack}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  <div className="cw-challenge-actions">
                    {canAccept ? (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={() => void acceptChallenge(r.id)}
                      >
                        Принять вызов
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button
                        type="button"
                        className="btn cw-cancel-btn"
                        disabled={busy}
                        onClick={() => void cancelChallenge(r.id)}
                      >
                        Отменить
                      </button>
                    ) : null}
                    {isMine && r.status === "OPEN" && !canCancel ? (
                      <span className="muted">ваша заявка</span>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      ) : null}

      {acceptPick ? (
        <div
          className="cw-stack-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cw-stack-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setAcceptPick(null);
          }}
        >
          <div className="cw-stack-dialog card">
            <h4 id="cw-stack-modal-title" style={{ marginTop: 0 }}>
              Какой состав играет?
            </h4>
            <p className="muted" style={{ marginTop: 0 }}>
              В клане несколько составов — выбери, кто примет этот вызов.
            </p>
            <div className="cw-stack-options">
              {mySquads.map((s) => (
                <label key={s.id} className="cw-stack-option">
                  <input
                    type="radio"
                    name="cw-accept-squad"
                    value={s.id}
                    checked={acceptPick.squadId === s.id}
                    onChange={() =>
                      setAcceptPick((p) =>
                        p ? { ...p, squadId: s.id } : p
                      )
                    }
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
            <div className="avatar-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !acceptPick.squadId}
                onClick={() => void confirmAcceptWithSquad()}
              >
                {busy ? "…" : "Принять вызов"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setAcceptPick(null)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

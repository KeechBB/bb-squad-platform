"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { MvpHits, MvpKind, MvpMatchHit } from "@/lib/mvpHits";

export type { MvpHits, MvpKind, MvpMatchHit } from "@/lib/mvpHits";
export { mvpHitsFromKvAwards } from "@/lib/mvpHits";

/** Единая сетка 12 клеток: трени / паб / КВ. */

export type CombatGridInput = {
  matches: number;
  rounds?: number | null;
  wins: number;
  draws?: number;
  losses: number;
  winrate: number;
  kills: number;
  deaths: number;
  kd: number;
  avgKills: number;
  dmg: number;
  avgDmg: number;
  res: number;
  nok: number;
  mvpKiller: number;
  mvpMedic: number;
  /** нет на трени/КВ → 0 */
  mvpArmor?: number | null;
  /** нет на трени/КВ → 0 */
  vehicleKills?: number | null;
  /**
   * TU из рейтинга КВ: (киллы + ресы − смерти) / катки.
   * Если задано — клетка «Урон» становится «Ср. тикеты».
   */
  avgTickets?: number | null;
  /**
   * Паблик / тренировки: вместо «Урон + Ср. урон» — широкий блок RP.
   */
  ratingRp?: {
    title: string;
    rp: number | null;
    rankLabel: string | null;
    rankKey: string | null;
    predatorPlace?: number | null;
  } | null;
};

type CellTone =
  | "neutral"
  | "mvp-killer"
  | "mvp-medic"
  | "mvp-armor"
  | "rp";

type Cell = {
  tone: CellTone;
  label: string;
  value: ReactNode;
  sub?: string;
  mvpKind?: MvpKind;
  span?: 2;
  rankKey?: string | null;
};

const MVP_TITLE: Record<MvpKind, string> = {
  killer: "MVP Killer",
  medic: "MVP Medic",
  armor: "MVP Armor",
};

function cellsFrom(s: CombatGridInput): Cell[] {
  const wl =
    s.draws != null && s.draws > 0
      ? `${s.wins}–${s.draws}–${s.losses}`
      : `${s.wins}–${s.losses}`;
  const armor = Number(s.mvpArmor) || 0;
  const veh = Number(s.vehicleKills) || 0;

  return [
    {
      tone: "neutral",
      label: s.rounds != null ? "Матчи / раунды" : "Катки",
      value:
        s.rounds != null ? (
          <>
            {s.matches}
            <em> / {s.rounds}</em>
          </>
        ) : (
          s.matches
        ),
    },
    {
      tone: "neutral",
      label: s.draws != null && s.draws > 0 ? "W–D–L" : "W–L",
      value: wl,
      sub: `winrate ${s.winrate}%`,
    },
    {
      tone: "neutral",
      label: "K / D",
      value: (
        <>
          {s.kills}
          <em> / {s.deaths}</em>
        </>
      ),
      sub: `KD ${s.kd}`,
    },
    {
      tone: "neutral",
      label: "Ср. киллы / катка",
      value: s.avgKills,
    },
    ...(s.ratingRp
      ? ([
          {
            tone: "neutral" as const,
            label: "Revives",
            value: s.res,
          },
          {
            tone: "rp" as const,
            label: s.ratingRp.title,
            span: 2 as const,
            rankKey: s.ratingRp.rankKey,
            value:
              s.ratingRp.rp != null ? (
                <>
                  <span
                    className={`home-pwr-badge rank-${s.ratingRp.rankKey || "iron"}`}
                  >
                    {s.ratingRp.predatorPlace
                      ? `PREDATOR #${s.ratingRp.predatorPlace}`
                      : s.ratingRp.rankLabel || "—"}
                  </span>
                  <em>
                    {" "}
                    {Math.round(s.ratingRp.rp).toLocaleString("ru-RU")} RP
                  </em>
                </>
              ) : (
                "—"
              ),
          },
          {
            tone: "neutral" as const,
            label: "Ноки",
            value: s.nok,
          },
        ] as Cell[])
      : ([
          s.avgTickets != null
            ? {
                tone: "neutral" as const,
                label: "Ср. тикеты / катка",
                value: s.avgTickets,
                sub: "TU · килл+рес−смерть",
              }
            : {
                tone: "neutral" as const,
                label: "Урон",
                value: s.dmg.toLocaleString("ru-RU"),
              },
          {
            tone: "neutral" as const,
            label: "Ср. урон / катка",
            value: s.avgDmg,
          },
          {
            tone: "neutral" as const,
            label: "Revives",
            value: s.res,
          },
          {
            tone: "neutral" as const,
            label: "Ноки",
            value: s.nok,
          },
        ] as Cell[])),
    {
      tone: "mvp-killer",
      label: "MVP Killer",
      value: s.mvpKiller,
      mvpKind: "killer",
    },
    {
      tone: "mvp-medic",
      label: "MVP Medic",
      value: s.mvpMedic,
      mvpKind: "medic",
    },
    {
      tone: "mvp-armor",
      label: "MVP Armor",
      value: armor,
      mvpKind: "armor",
    },
    {
      tone: "neutral",
      label: "Техника",
      value: veh,
    },
  ];
}

function MvpListModal({
  kind,
  hits,
  loading,
  onClose,
}: {
  kind: MvpKind;
  hits: MvpMatchHit[];
  loading: boolean;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("profile-match-modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("profile-match-modal-open");
    };
  }, [onClose]);

  const modal = (
    <div className="profile-match-modal" role="presentation">
      <button
        type="button"
        className="profile-match-modal-backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        className={`profile-match-modal-panel profile-mvp-list-panel tone-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="profile-match-modal-head">
          <div>
            <h2 id={titleId}>{MVP_TITLE[kind]}</h2>
            <p className="profile-match-modal-sub">
              Матчи, где ты получил эту награду
            </p>
          </div>
          <button
            type="button"
            className="profile-match-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>
        <div className="profile-match-modal-body profile-mvp-list-body">
          {loading ? (
            <p className="profile-mvp-list-empty">Загрузка…</p>
          ) : hits.length === 0 ? (
            <p className="profile-mvp-list-empty">
              Пока нет матчей с этим MVP.
            </p>
          ) : (
            <ul className="profile-mvp-list">
              {hits.map((h) => (
                <li key={h.id} className="profile-mvp-list-item">
                  <time>{h.dateLabel}</time>
                  <strong>{h.title}</strong>
                  {h.sub ? <span>{h.sub}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

type Props = {
  stats: CombatGridInput;
  /** Предзагруженные списки (КВ awards / трени) */
  mvpHits?: MvpHits | null;
  /** Если списков нет — подтянуть по клику */
  mvpFetch?: {
    nick: string;
    mode: "train" | "cw" | "public";
  } | null;
};

export function ProfileCombatGrid({ stats, mvpHits, mvpFetch }: Props) {
  const cells = cellsFrom(stats);
  const [openKind, setOpenKind] = useState<MvpKind | null>(null);
  const [fetched, setFetched] = useState<Partial<MvpHits>>({});
  const [loading, setLoading] = useState(false);

  const resolveHits = useCallback(
    (kind: MvpKind): MvpMatchHit[] => {
      if (mvpHits?.[kind]?.length) return mvpHits[kind];
      return fetched[kind] || [];
    },
    [mvpHits, fetched]
  );

  const openMvp = useCallback(
    async (kind: MvpKind) => {
      setOpenKind(kind);
      if (mvpHits?.[kind]) return;
      if (fetched[kind]) return;
      if (!mvpFetch?.nick) return;
      setLoading(true);
      try {
        const q = new URLSearchParams({
          nick: mvpFetch.nick,
          mode: mvpFetch.mode,
          kind,
        });
        const res = await fetch(`/api/profile/mvp-matches?${q}`);
        const data = (await res.json().catch(() => null)) as {
          hits?: MvpMatchHit[];
        } | null;
        setFetched((prev) => ({
          ...prev,
          [kind]: Array.isArray(data?.hits) ? data!.hits! : [],
        }));
      } catch {
        setFetched((prev) => ({ ...prev, [kind]: [] }));
      } finally {
        setLoading(false);
      }
    },
    [mvpHits, fetched, mvpFetch]
  );

  return (
    <>
      <div className="profile-kv-grid-12" role="list">
        {cells.map((c) => {
          const className = [
            "profile-kv-cell",
            `tone-${c.tone}`,
            c.mvpKind ? "is-mvp is-clickable" : "",
            c.span === 2 ? "is-span-2" : "",
            c.tone === "rp" && c.rankKey ? `rank-${c.rankKey}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          const inner = (
            <>
              <span className="profile-kv-cell-label">{c.label}</span>
              <strong>{c.value}</strong>
              {c.sub ? <em className="stat-sub">{c.sub}</em> : null}
            </>
          );
          if (c.mvpKind) {
            const kind = c.mvpKind;
            return (
              <button
                key={c.label}
                type="button"
                className={className}
                onClick={() => {
                  void openMvp(kind);
                }}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={c.label} role="listitem" className={className}>
              {inner}
            </div>
          );
        })}
      </div>
      {openKind ? (
        <MvpListModal
          kind={openKind}
          hits={resolveHits(openKind)}
          loading={loading && !resolveHits(openKind).length}
          onClose={() => setOpenKind(null)}
        />
      ) : null}
    </>
  );
}

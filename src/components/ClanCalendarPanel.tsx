"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { canonOpp, clanLogoUrl } from "@/lib/clanLogo";
import { CW_MODE_IMAGE_V } from "@/lib/cwChallenge";
import {
  confidenceLabel,
  formatMatchDate,
  type MatchForecast,
} from "@/lib/kvForecastUi";

function resolveLogoSrc(
  src: string | null | undefined,
  fallbackKey?: string | null,
  alt?: string
) {
  // Свой URL (rating-logos / api/clans/logo) важнее fallback —
  // иначе у чужих кланов всегда подставлялся BB-MAIN.
  // /uploads/ часто битый — пробуем канон раньше него.
  const raw = String(src || "").trim();
  const srcOk =
    raw &&
    (raw.includes("/rating-logos/") ||
      raw.includes("/api/clans/logo/") ||
      (!raw.includes("/uploads/") && raw.startsWith("/")));
  if (srcOk) return raw;
  return (
    clanLogoUrl(fallbackKey || "") ||
    clanLogoUrl(alt || "") ||
    (raw || "")
  );
}

function ourStackFallbackKey(clanTag: string, stack: string): string {
  const tag = String(clanTag || "").trim().toUpperCase();
  if (tag === "BB") {
    return stackMark(stack).cls === "is-junior" ? "BB-JUNIOR" : "BB-MAIN";
  }
  return tag || "BB-MAIN";
}

function LogoImg({
  src,
  alt,
  className,
  fallbackKey,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallbackKey?: string | null;
}) {
  const [url, setUrl] = useState(() => resolveLogoSrc(src, fallbackKey, alt));
  useEffect(() => {
    setUrl(resolveLogoSrc(src, fallbackKey, alt));
  }, [src, fallbackKey, alt]);
  if (!url) {
    return (
      <span className={`clan-fifa-club-fallback ${className || ""}`}>
        {alt.slice(0, 4)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={url}
      alt={alt}
      onError={() => {
        const fb =
          clanLogoUrl(fallbackKey || "") ||
          clanLogoUrl(alt) ||
          "";
        if (fb && fb !== url) setUrl(fb);
        else setUrl("");
      }}
    />
  );
}

function serverLogoKey(server: string): string | null {
  const s = String(server || "").trim();
  if (!s || s === "—" || /^any$/i.test(s) || /^tbd$/i.test(s)) return null;
  const c = canonOpp(s);
  return clanLogoUrl(c.key) || clanLogoUrl(s) ? c.key : null;
}

type ClanCalMatch = {
  key: string;
  day: number;
  month: number;
  year: number;
  timeMsk: string;
  opp: string;
  map: string;
  mapShort: string;
  size: string;
  stack: string;
  server: string;
  rules: string;
  note: string | null;
  status: string;
  meeting: string | null;
  forecast: MatchForecast;
  modeId: string;
  modeLabel: string;
  modeImage: string;
  ourLogo: string | null;
  oppLogo: string | null;
  formatLabel: string;
  source: "kv" | "challenge";
};

type Props = {
  clanId: string;
  clanTag: string;
  clanName?: string;
  clanLogoUrl?: string | null;
};

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function mskToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { year: n("year"), month: n("month"), day: n("day") };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function mondayIndex(year: number, month: number) {
  const js = new Date(year, month - 1, 1).getDay();
  return js === 0 ? 6 : js - 1;
}

function pctTone(winPct: number) {
  if (winPct >= 55) return "is-good";
  if (winPct <= 42) return "is-bad";
  return "";
}

function statusLabel(status: string) {
  if (status === "win") return "Победа";
  if (status === "lose") return "Поражение";
  if (status === "draw") return "Ничья";
  if (status === "upcoming") return "Скоро";
  if (status === "cancel") return "Отмена";
  if (status === "done") return "Сыграно";
  return "Матч";
}

function stackMark(stack: string) {
  const s = String(stack || "").toLowerCase();
  if (s.includes("jun")) return { cls: "is-junior", label: "Junior" };
  if (s.includes("main")) return { cls: "is-main", label: "Main" };
  const label = String(stack || "").trim() || "—";
  return { cls: "is-other", label: label.slice(0, 10) };
}

function WinRing({ pct, tone }: { pct: number; tone: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className={`clan-fifa-winring ${tone}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 52 52" width="56" height="56">
        <circle className="clan-fifa-winring-track" cx="26" cy="26" r={r} />
        <circle
          className="clan-fifa-winring-value"
          cx="26"
          cy="26"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 26 26)"
        />
      </svg>
      <span className="clan-fifa-winring-num">{pct}%</span>
    </div>
  );
}

export function ClanCalendarPanel({
  clanId,
  clanTag,
  clanName,
  clanLogoUrl,
}: Props) {
  const [matches, setMatches] = useState<ClanCalMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = useMemo(() => mskToday(), []);
  const [cursor, setCursor] = useState(() => ({
    year: today.year,
    month: today.month,
  }));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/clans/${clanId}/calendar`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка загрузки");
        return;
      }
      setMatches(data.matches || []);
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }, [clanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<number, ClanCalMatch[]>();
    for (const m of matches) {
      if (m.year !== cursor.year || m.month !== cursor.month) continue;
      const list = map.get(m.day) || [];
      list.push(m);
      map.set(m.day, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.timeMsk.localeCompare(b.timeMsk));
    }
    return map;
  }, [matches, cursor.year, cursor.month]);

  const selected = useMemo(() => {
    if (selectedKey) {
      return matches.find((m) => m.key === selectedKey) || null;
    }
    // auto-pick nearest upcoming in month
    const monthMatches = matches.filter(
      (m) => m.year === cursor.year && m.month === cursor.month
    );
    const up = monthMatches.find((m) => m.status === "upcoming");
    return up || monthMatches[0] || null;
  }, [matches, selectedKey, cursor.year, cursor.month]);

  const cells = useMemo(() => {
    const lead = mondayIndex(cursor.year, cursor.month);
    const count = daysInMonth(cursor.year, cursor.month);
    const out: Array<number | null> = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => i + 1),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor.year, cursor.month]);

  function shiftMonth(delta: number) {
    setSelectedKey(null);
    setCursor((cur) => {
      const d = new Date(cur.year, cur.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }

  const ourTitle = clanName ? `[${clanTag}] ${clanName}` : `[${clanTag}]`;

  return (
    <section className="clan-fifa-cal" aria-label={`Календарь ${clanTag}`}>
      <header className="clan-fifa-head">
        <div>
          <p className="clan-fifa-eyebrow">календарь площадки · КВ</p>
          <h3>Календарь {ourTitle}</h3>
        </div>
        <div className="clan-fifa-month-nav">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Пред. месяц">
            ‹
          </button>
          <strong>
            {MONTHS[cursor.month - 1]} {cursor.year}
          </strong>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="След. месяц">
            ›
          </button>
        </div>
      </header>

      {loading ? <p className="muted">Загрузка календаря…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error ? (
        <div className="clan-fifa-layout">
          <div className="clan-fifa-pitch">
            <div className="clan-fifa-weekdays" aria-hidden="true">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="clan-fifa-grid">
              {cells.map((n, i) => {
                if (n == null) {
                  return <div key={`e${i}`} className="clan-fifa-cell is-empty" />;
                }
                const list = byDay.get(n) || [];
                const isToday =
                  n === today.day &&
                  cursor.month === today.month &&
                  cursor.year === today.year;
                const weekend = i % 7 >= 5;
                const primary = list[0] || null;
                const isSelected =
                  primary != null &&
                  selected != null &&
                  list.some((m) => m.key === selected.key);
                return (
                  <button
                    key={n}
                    type="button"
                    className={[
                      "clan-fifa-cell",
                      list.length ? "has-match" : "",
                      primary ? `is-${primary.status || "play"}` : "",
                      primary ? `is-mode-${primary.modeId.toLowerCase()}` : "",
                      isToday ? "is-today" : "",
                      weekend ? "is-weekend" : "",
                      isSelected ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (primary) setSelectedKey(primary.key);
                    }}
                  >
                    <span className="clan-fifa-cell-num">{n}</span>
                    {primary ? (
                      <>
                        <span className="clan-fifa-cell-time">{primary.timeMsk}</span>
                        <span className="clan-fifa-cell-logos">
                          <LogoImg
                            src={primary.ourLogo}
                            alt={clanTag}
                            fallbackKey={ourStackFallbackKey(
                              clanTag,
                              primary.stack
                            )}
                          />
                          <LogoImg
                            src={primary.oppLogo}
                            alt={canonOpp(primary.opp).tag}
                            fallbackKey={canonOpp(primary.opp).key}
                          />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            className="clan-fifa-cell-mod"
                            src={`${primary.modeImage}?v=${CW_MODE_IMAGE_V}`}
                            alt={primary.modeLabel}
                          />
                        </span>
                        {list.length > 1 ? (
                          <span className="clan-fifa-cell-more">+{list.length - 1}</span>
                        ) : null}
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="clan-fifa-hint muted">
              Кликни день с матчем — справа карточка, логотипы, мод и предикт.
            </p>
          </div>

          <aside className="clan-fifa-side">
            {selected ? (
              <>
                <div className="clan-fifa-side-league">
                  <span>{selected.modeLabel}</span>
                  <strong>
                    {formatMatchDate(selected.day, selected.month, selected.year)} ·{" "}
                    {selected.timeMsk} МСК
                  </strong>
                </div>

                <div className="clan-fifa-faceoff">
                  <div className="clan-fifa-club">
                    <LogoImg
                      src={selected.ourLogo || clanLogoUrl}
                      alt={clanTag}
                      fallbackKey={ourStackFallbackKey(
                        clanTag,
                        selected.stack
                      )}
                    />
                    <em>
                      {String(clanTag || "").toUpperCase() === "BB"
                        ? stackMark(selected.stack).label
                        : clanTag}
                    </em>
                  </div>
                  <div className="clan-fifa-vs">
                    <span>VS</span>
                    <WinRing
                      pct={selected.forecast.winPct}
                      tone={pctTone(selected.forecast.winPct)}
                    />
                  </div>
                  <div className="clan-fifa-club">
                    <LogoImg
                      src={selected.oppLogo}
                      alt={canonOpp(selected.opp).tag}
                      fallbackKey={canonOpp(selected.opp).key}
                    />
                    <em>{canonOpp(selected.opp).name}</em>
                  </div>
                </div>

                <div className={`clan-fifa-modbanner is-mode-${selected.modeId.toLowerCase()}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${selected.modeImage}?v=${CW_MODE_IMAGE_V}`}
                    alt={selected.modeLabel}
                  />
                  <div>
                    <strong>{selected.modeLabel}</strong>
                    <span>{selected.map}</span>
                  </div>
                </div>

                <div className="clan-fifa-statrow">
                  <div>
                    <span>Статус</span>
                    <b>{statusLabel(selected.status)}</b>
                  </div>
                  <div>
                    <span>Формат</span>
                    <b>{selected.formatLabel}</b>
                  </div>
                  <div>
                    <span>Сервер</span>
                    <b className="clan-fifa-server">
                      {(() => {
                        const sk = serverLogoKey(selected.server);
                        return sk ? (
                          <LogoImg
                            src={null}
                            alt={selected.server}
                            fallbackKey={sk}
                            className="clan-fifa-server-logo"
                          />
                        ) : null;
                      })()}
                      {selected.server && selected.server !== "—"
                        ? selected.server
                        : "TBD"}
                    </b>
                  </div>
                </div>

                <div
                  className="clan-fifa-bar"
                  title={`W ${selected.forecast.winPct}% · D ${selected.forecast.drawPct}% · L ${selected.forecast.losePct}%`}
                >
                  <i style={{ width: `${selected.forecast.winPct}%` }} className="w" />
                  <i style={{ width: `${selected.forecast.drawPct}%` }} className="d" />
                  <i style={{ width: `${selected.forecast.losePct}%` }} className="l" />
                </div>
                <p className="clan-fifa-confidence muted">
                  Предикт победы · {confidenceLabel(selected.forecast.confidence)}
                  {selected.meeting ? ` · ${selected.meeting}` : ""}
                </p>
                <p className="clan-fifa-summary">{selected.forecast.summary}</p>
                <ul className="clan-fifa-factors">
                  {selected.forecast.factors.map((fac) => (
                    <li key={fac.label} className={`tone-${fac.tone}`}>
                      <span>{fac.label}</span>
                      <strong>{fac.value}</strong>
                    </li>
                  ))}
                </ul>
                {selected.note ? (
                  <p className="clan-fifa-note muted">Заметка: {selected.note}</p>
                ) : null}

                {byDay.get(selected.day) && byDay.get(selected.day)!.length > 1 ? (
                  <div className="clan-fifa-daylist">
                    <span className="muted">Матчи дня</span>
                    {byDay.get(selected.day)!.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={`is-mode-${m.modeId.toLowerCase()}${
                          m.key === selected.key ? " is-active" : ""
                        }`}
                        onClick={() => setSelectedKey(m.key)}
                      >
                        <LogoImg
                          src={m.oppLogo}
                          alt={canonOpp(m.opp).tag}
                          fallbackKey={canonOpp(m.opp).key}
                        />
                        <span>
                          {m.timeMsk} · {stackMark(m.stack).label} vs{" "}
                          {canonOpp(m.opp).tag}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="clan-fifa-empty">
                <p className="clan-fifa-empty-title">NO MATCH</p>
                <p className="muted">
                  В этом месяце нет выбранного матча. Кликни день с логотипом
                  соперника.
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

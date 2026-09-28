"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MapPinGroup = {
  key: string;
  country: string;
  region: string | null;
  city: string;
  lat: number;
  lon: number;
  members: { userId: string; nick: string; pinId: string }[];
};

type MyPin = {
  id: string;
  country: string;
  region: string | null;
  city: string;
  lat: number;
  lon: number;
} | null;

type GeocodeHit = {
  lat: number;
  lon: number;
  label: string;
  country: string;
  region: string | null;
  city: string;
};

type WizardStep = "country" | "region" | "city" | "pick" | null;

export function ClanMapClient() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _destructor?: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsData: (d: any) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    htmlElementsData: (d: any) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ringsData: (d: any) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointOfView: (pov?: any, ms?: number) => unknown;
  } | null>(null);

  const [groups, setGroups] = useState<MapPinGroup[]>([]);
  const groupsRef = useRef<MapPinGroup[]>([]);
  groupsRef.current = groups;
  const [myPin, setMyPin] = useState<MyPin>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<MapPinGroup | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<MapPinGroup | null>(null);

  const [wizard, setWizard] = useState<WizardStep>(null);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [wizardErr, setWizardErr] = useState<string | null>(null);

  const loadPins = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/map/pins", { cache: "no-store" });
      const text = await res.text();
      let data: {
        error?: string;
        groups?: MapPinGroup[];
        myPin?: MyPin;
        myUserId?: string | null;
        canModerate?: boolean;
      } = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          throw new Error(
            res.ok
              ? "Сервер вернул пустой ответ карты"
              : `Ошибка карты (${res.status})`
          );
        }
      } else if (!res.ok) {
        throw new Error(`Ошибка карты (${res.status})`);
      }
      if (!res.ok) throw new Error(data.error || `Ошибка загрузки (${res.status})`);
      setGroups(data.groups || []);
      setMyPin(data.myPin || null);
      setMyUserId(data.myUserId || null);
      setCanModerate(Boolean(data.canModerate));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPins();
  }, [loadPins]);

  // Init globe once
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false;
    let resizeObs: ResizeObserver | null = null;
    const onMove = (ev: MouseEvent) => {
      setHoverPos({ x: ev.clientX, y: ev.clientY });
    };

    (async () => {
      const [{ default: Globe }, topojson, world] = await Promise.all([
        import("globe.gl"),
        import("topojson-client"),
        fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((r) =>
          r.json()
        ),
      ]);
      if (dead || !hostRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countries = (topojson as any).feature(world, world.objects.countries);

      // antialias + soft borders (bright 1px strokes shimmer/moire when rotating)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = new (Globe as any)(el, {
        animateIn: false,
        rendererConfig: {
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        },
      })
        .backgroundColor("rgba(0,0,0,0)")
        .showGlobe(true)
        .showAtmosphere(true)
        .atmosphereColor("#7c3aed")
        .atmosphereAltitude(0.2)
        .globeImageUrl("//cdn.jsdelivr.net/npm/three-globe/example/img/earth-dark.jpg")
        .polygonsData(countries.features)
        .polygonCapColor(() => "rgba(6,5,12,0.94)")
        .polygonSideColor(() => "rgba(100, 70, 180, 0.35)")
        // soft stroke — not neon hairline (hairlines = рябь)
        .polygonStrokeColor(() => "rgba(140, 110, 210, 0.28)")
        .polygonAltitude(0.005)
        .polygonsTransitionDuration(0)
        .pointsData([])
        .pointLat("lat")
        .pointLng("lon")
        .pointAltitude(0.012)
        .pointRadius(0.12)
        .pointColor(() => "rgba(196,181,253,0.15)")
        .pointLabel(() => "")
        .onPointHover((d: object | null) => {
          if (!d) {
            setHover(null);
            return;
          }
          setHover(d as MapPinGroup);
        })
        .onPointClick((d: object) => {
          const grp = d as MapPinGroup;
          setHover(grp);
          setPanel(grp);
        })
        // atmospheric glow rings around player markers
        .ringsData([])
        .ringLat("lat")
        .ringLng("lon")
        .ringAltitude(0.014)
        .ringColor(() => (t: number) => `rgba(167,139,250,${0.55 * Math.sqrt(Math.max(0, 1 - t))})`)
        .ringMaxRadius(2.4)
        .ringPropagationSpeed(1.4)
        .ringRepeatPeriod(1600)
        // HTML pin with CSS bloom (like planet atmosphere)
        .htmlElementsData([])
        .htmlLat("lat")
        .htmlLng("lon")
        .htmlAltitude(0.022)
        .htmlElement((d: object) => {
          const grp = d as MapPinGroup;
          const wrap = document.createElement("div");
          wrap.className = "clan-map-pin-wrap";
          wrap.title = `${grp.city} · ${grp.country}`;
          const glow = document.createElement("div");
          glow.className = "clan-map-pin-glow";
          const core = document.createElement("div");
          core.className = "clan-map-pin-core";
          if (grp.members.length > 1) {
            const badge = document.createElement("span");
            badge.className = "clan-map-pin-n";
            badge.textContent = String(grp.members.length);
            wrap.append(glow, core, badge);
          } else {
            wrap.append(glow, core);
          }
          wrap.addEventListener("mouseenter", () => setHover(grp));
          wrap.addEventListener("mouseleave", () => setHover(null));
          wrap.addEventListener("click", (ev) => {
            ev.stopPropagation();
            setHover(grp);
            setPanel(grp);
          });
          return wrap;
        });

      el.addEventListener("mousemove", onMove);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderer = (g as any).renderer?.();
        if (renderer?.setPixelRatio) {
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        }
      } catch {
        /* ignore */
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = (g as any).globeMaterial?.();
      if (mat) {
        mat.color?.setHex?.(0x080612);
        mat.emissive?.setHex?.(0x120a22);
        mat.emissiveIntensity = 0.12;
      }

      const fit = () => {
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        g.width(w).height(h);
      };
      fit();
      resizeObs = new ResizeObserver(fit);
      resizeObs.observe(el);

      g.pointOfView({ lat: 40, lng: 40, altitude: 2.1 }, 0);
      const pins = groupsRef.current;
      g.pointsData(pins);
      g.ringsData(pins);
      g.htmlElementsData(pins);
      globeRef.current = g as unknown as typeof globeRef.current;
    })().catch((e) => {
      console.error(e);
      setError("Не удалось загрузить глобус");
    });

    return () => {
      dead = true;
      resizeObs?.disconnect();
      el.removeEventListener("mousemove", onMove);
      try {
        globeRef.current?._destructor?.();
      } catch {
        /* ignore */
      }
      globeRef.current = null;
      if (el) el.innerHTML = "";
    };
  }, []);

  // Sync points + glow rings + HTML pins
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointsData(groups);
    g.ringsData(groups);
    g.htmlElementsData(groups);
  }, [groups]);

  async function runGeocode() {
    setBusy(true);
    setWizardErr(null);
    try {
      const qs = new URLSearchParams({
        country: country.trim(),
        region: region.trim(),
        city: city.trim(),
      });
      const res = await fetch(`/api/map/geocode?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не найдено");
      const list = (data.hits || []) as GeocodeHit[];
      setHits(list);
      if (list.length === 1) {
        await saveHit(list[0]);
      } else {
        setWizard("pick");
      }
    } catch (e) {
      setWizardErr(e instanceof Error ? e.message : "Ошибка поиска");
    } finally {
      setBusy(false);
    }
  }

  async function saveHit(hit: GeocodeHit) {
    setBusy(true);
    setWizardErr(null);
    try {
      const res = await fetch("/api/map/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: hit.country || country.trim(),
          region: hit.region || region.trim() || null,
          city: hit.city || city.trim(),
          lat: hit.lat,
          lon: hit.lon,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить");
      setWizard(null);
      setCountry("");
      setRegion("");
      setCity("");
      setHits([]);
      await loadPins();
      globeRef.current?.pointOfView?.({ lat: hit.lat, lng: hit.lon, altitude: 1.6 }, 1200);
    } catch (e) {
      setWizardErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function removeOwnPin() {
    if (!confirm("Убрать свою метку с карты? Потом можно поставить снова.")) return;
    setBusy(true);
    try {
      await fetch("/api/map/pins", { method: "DELETE" });
      await loadPins();
      setHover(null);
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeMemberPin(userId: string, nick: string) {
    const own = userId === myUserId;
    const msg = own
      ? "Убрать свою метку?"
      : `Снять метку игрока ${nick}? (модерация)`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const qs = own ? "" : `?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(`/api/map/pins${qs}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось удалить");
      await loadPins();
      setHover(null);
      setPanel(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function openWizard() {
    setWizardErr(null);
    setHits([]);
    setCountry(myPin?.country || "");
    setRegion(myPin?.region || "");
    setCity(myPin?.city || "");
    setWizard("country");
  }

  const tip = panel || (hover && hoverPos ? hover : null);

  return (
    <div className="clan-map-page">
      <div className="clan-map-bar">
        <div className="clan-map-bar-left">
          <h1>Клановая карта</h1>
          <p className="clan-map-hint">
            Зажми ЛКМ и крути · клик по огоньку — кто в городе
            {canModerate ? " · ты можешь снимать чужие метки" : ""}
          </p>
        </div>
        <div className="clan-map-bar-actions">
          {myPin ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void removeOwnPin()}>
              Убрать мою метку
            </button>
          ) : null}
          <button type="button" className="btn primary" disabled={busy} onClick={openWizard}>
            {myPin ? "Изменить свою метку" : "Добавить метку на карте"}
          </button>
        </div>
      </div>

      <div className="clan-map-stage" ref={hostRef} />

      {loading ? <div className="clan-map-status">Загрузка…</div> : null}
      {error ? <div className="clan-map-status err">{error}</div> : null}

      {tip ? (
        <div
          className={`clan-map-tip${panel ? " clan-map-tip-panel" : ""}`}
          style={
            panel
              ? undefined
              : hoverPos
                ? { left: hoverPos.x + 14, top: hoverPos.y + 14 }
                : undefined
          }
          role="status"
        >
          {panel ? (
            <button
              type="button"
              className="clan-map-tip-close"
              onClick={() => setPanel(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
          ) : null}
          <strong>
            {tip.city}
            {tip.region ? `, ${tip.region}` : ""} · {tip.country}
          </strong>
          <span className="muted">Участники ({tip.members.length}):</span>
          <ul className="clan-map-tip-list">
            {tip.members.map((m) => {
              const canRemove = m.userId === myUserId || canModerate;
              return (
                <li key={m.userId}>
                  <span>{m.nick}</span>
                  {canRemove && panel ? (
                    <button
                      type="button"
                      className="clan-map-tip-rm"
                      disabled={busy}
                      onClick={() => void removeMemberPin(m.userId, m.nick)}
                    >
                      убрать
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {panel ? (
            <p className="clan-map-tip-note">
              {canModerate
                ? "Кликни «убрать» у любой метки (модерация) или у своей."
                : "Свою метку можно убрать и поставить заново."}
            </p>
          ) : (
            <p className="clan-map-tip-note">Кликни по точке — управление метками</p>
          )}
        </div>
      ) : null}

      {wizard ? (
        <div className="clan-map-modal-bg" role="dialog" aria-modal="true">
          <div className="clan-map-modal">
            <header>
              <h2>Добавить метку</h2>
              <button type="button" className="btn ghost" onClick={() => setWizard(null)} disabled={busy}>
                Закрыть
              </button>
            </header>

            {wizard === "country" ? (
              <div className="clan-map-wizard">
                <p>1 / 3 · Страна</p>
                <input
                  autoFocus
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Например: Россия"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && country.trim().length >= 2) setWizard("region");
                  }}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={country.trim().length < 2}
                  onClick={() => setWizard("region")}
                >
                  Далее
                </button>
              </div>
            ) : null}

            {wizard === "region" ? (
              <div className="clan-map-wizard">
                <p>2 / 3 · Область / край / штат (если есть)</p>
                <input
                  autoFocus
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Например: Московская область"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setWizard("city");
                  }}
                />
                <div className="clan-map-wizard-row">
                  <button type="button" className="btn ghost" onClick={() => setWizard("country")}>
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setRegion("");
                      setWizard("city");
                    }}
                  >
                    Пропустить
                  </button>
                  <button type="button" className="btn primary" onClick={() => setWizard("city")}>
                    Далее
                  </button>
                </div>
              </div>
            ) : null}

            {wizard === "city" ? (
              <div className="clan-map-wizard">
                <p>3 / 3 · Город</p>
                <input
                  autoFocus
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Например: Москва"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && city.trim() && !busy) void runGeocode();
                  }}
                />
                <div className="clan-map-wizard-row">
                  <button type="button" className="btn ghost" onClick={() => setWizard("region")} disabled={busy}>
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!city.trim() || busy}
                    onClick={() => void runGeocode()}
                  >
                    {busy ? "Ищем…" : "Найти на карте"}
                  </button>
                </div>
              </div>
            ) : null}

            {wizard === "pick" ? (
              <div className="clan-map-wizard">
                <p>Выбери точное место:</p>
                <ul className="clan-map-hits">
                  {hits.map((h, i) => (
                    <li key={`${h.lat}-${h.lon}-${i}`}>
                      <button type="button" disabled={busy} onClick={() => void saveHit(h)}>
                        {h.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn ghost" onClick={() => setWizard("city")} disabled={busy}>
                  Назад
                </button>
              </div>
            ) : null}

            {wizardErr ? <p className="clan-map-wizard-err">{wizardErr}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
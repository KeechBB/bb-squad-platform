"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AdminTermRangeModal } from "@/components/AdminTermRangeModal";
import {
  ADMIN_PAGE_SIZE,
  compareLoose,
  fuzzyIncludes,
  fuzzyScore,
  foldSearch,
  type SortDir,
} from "@/lib/adminFuzzyList";
import "@/app/admin/panelka/panelka.css";

type VipRow = {
  steamId: string;
  nick: string | null;
  startsAt: string | null;
  endsAt: string | null;
  forever: boolean;
  termLabel?: string;
  byNick: string;
  grantedAt: string | null;
  note: string | null;
  source: string;
};

type SortKey = "nick" | "steamId" | "startsAt" | "endsAt" | "byNick" | "grantedAt" | "note";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function termCell(row: VipRow): string {
  if (row.termLabel) return row.termLabel;
  if (row.forever) return "навсегда";
  if (row.endsAt) return `до ${fmt(row.endsAt)}`;
  return "срок не указан";
}

function rowHay(row: VipRow): string {
  return [row.nick, row.steamId, row.byNick, row.note, row.endsAt, row.termLabel]
    .filter(Boolean)
    .join(" ");
}

export function AdminPublicVipsPanel() {
  const [rows, setRows] = useState<VipRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [prefill, setPrefill] = useState({ steamId: "", nick: "" });
  const [sortKey, setSortKey] = useState<SortKey>("grantedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await fetch("/api/admin/vips", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; vips?: VipRow[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "не удалось загрузить VIP");
      setRows(data.vips || []);
    } catch (e) {
      if (!opts?.silent) setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const needle = q.trim();
    const list = needle
      ? rows.filter((r) => fuzzyIncludes(rowHay(r), needle))
      : [...rows];
    list.sort((a, b) => {
      if (needle) {
        const sa = fuzzyScore(rowHay(a), needle);
        const sb = fuzzyScore(rowHay(b), needle);
        if (sa !== sb) return sb - sa;
      }
      const av =
        sortKey === "endsAt"
          ? a.forever
            ? "9999"
            : a.endsAt
          : a[sortKey];
      const bv =
        sortKey === "endsAt"
          ? b.forever
            ? "9999"
            : b.endsAt
          : b[sortKey];
      return compareLoose(av, bv, sortDir);
    });
    return list;
  }, [rows, q, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ADMIN_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (safePage - 1) * ADMIN_PAGE_SIZE,
    safePage * ADMIN_PAGE_SIZE
  );

  const suggestions = useMemo(() => {
    const needle = q.trim();
    if (needle.length < 1) return [];
    const seen = new Set<string>();
    const out: { label: string; value: string; sub?: string }[] = [];
    const scored = rows
      .map((r) => ({
        r,
        score: Math.max(
          fuzzyScore(r.nick || "", needle),
          fuzzyScore(r.steamId, needle),
          fuzzyScore(r.byNick || "", needle)
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { r } of scored) {
      const nick = (r.nick || "").trim();
      if (nick) {
        const key = `n:${foldSearch(nick)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ label: nick, value: nick, sub: r.steamId });
        }
      }
      const sidKey = `s:${r.steamId}`;
      if (!seen.has(sidKey) && fuzzyIncludes(r.steamId, needle)) {
        seen.add(sidKey);
        out.push({ label: r.steamId, value: r.steamId, sub: nick || undefined });
      }
      if (out.length >= 8) break;
    }
    return out;
  }, [rows, q]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(
        key === "nick" || key === "steamId" || key === "byNick" || key === "note"
          ? "asc"
          : "desc"
      );
    }
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  async function revoke(steamId: string) {
    if (!window.confirm(`Снять VIP (QueuePriority) с ${steamId}?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/vips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", steamId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reply?: string;
        vips?: VipRow[];
      };
      if (!res.ok || !data.ok) {
        setErr(data.error || "не снялось");
        return;
      }
      if (data.vips) setRows(data.vips);
      setNotice(data.reply || "снято");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card journal-card">
      <form
        className="journal-toolbar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setSuggestOpen(false);
        }}
      >
        <div className="admin-search-wrap" ref={searchWrapRef}>
          <label className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <span>Поиск</span>
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              placeholder="Ник или Steam ID… (похожие буквы тоже)"
              autoComplete="off"
            />
          </label>
          {suggestOpen && suggestions.length > 0 ? (
            <ul className="admin-suggest" role="listbox">
              {suggestions.map((s) => (
                <li key={`${s.value}-${s.sub || ""}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setQ(s.value);
                      setSuggestOpen(false);
                    }}
                  >
                    <span>{s.label}</span>
                    {s.sub ? <span className="muted">{s.sub}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setPrefill({ steamId: "", nick: "" });
            setGrantOpen(true);
          }}
        >
          Выдать VIP
        </button>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          Обновить
        </button>
      </form>

      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      {grantOpen ? (
        <AdminTermRangeModal
          title="Выдать VIP (приоритет очереди)"
          confirmLabel="Выдать"
          steamId={prefill.steamId}
          nick={prefill.nick}
          reasonLabel="Комментарий"
          placement="top"
          busy={busy}
          onClose={() => setGrantOpen(false)}
          onConfirm={(payload) => {
            void (async () => {
              setBusy(true);
              setErr(null);
              try {
                const res = await fetch("/api/admin/vips", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "grant",
                    steamId: payload.steamId,
                    nick: payload.nick,
                    note: payload.reason,
                    startsAt: new Date(payload.startsAt).toISOString(),
                    endsAt: payload.forever
                      ? null
                      : new Date(payload.endsAt).toISOString(),
                    forever: payload.forever,
                  }),
                });
                const data = (await res.json()) as {
                  ok?: boolean;
                  error?: string;
                  vips?: VipRow[];
                  reply?: string;
                };
                if (!res.ok || !data.ok) {
                  setErr(data.error || "не выдалось");
                  return;
                }
                if (data.vips) setRows(data.vips);
                setNotice(data.reply || "выдано");
                setGrantOpen(false);
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="admin-th-sort" onClick={() => toggleSort("nick")}>
                  Ник{sortMark("nick")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="admin-th-sort"
                  onClick={() => toggleSort("steamId")}
                >
                  Steam ID{sortMark("steamId")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="admin-th-sort"
                  onClick={() => toggleSort("startsAt")}
                >
                  От{sortMark("startsAt")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="admin-th-sort"
                  onClick={() => toggleSort("endsAt")}
                >
                  Срок{sortMark("endsAt")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="admin-th-sort"
                  onClick={() => toggleSort("byNick")}
                >
                  Выдал{sortMark("byNick")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="admin-th-sort"
                  onClick={() => toggleSort("grantedAt")}
                >
                  Когда{sortMark("grantedAt")}
                </button>
              </th>
              <th>
                <button type="button" className="admin-th-sort" onClick={() => toggleSort("note")}>
                  Комментарий{sortMark("note")}
                </button>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="muted">
                  Загрузка…
                </td>
              </tr>
            ) : null}
            {!loading && pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  Действующих VIP нет{q.trim() ? ` по запросу «${q.trim()}»` : ""}.
                </td>
              </tr>
            ) : null}
            {pageRows.map((row) => (
              <tr key={row.steamId}>
                <td>{row.nick || "—"}</td>
                <td className="mono admin-steam-id">
                  <a
                    href={`https://steamcommunity.com/profiles/${row.steamId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Открыть Steam"
                  >
                    {row.steamId}
                  </a>
                </td>
                <td>{fmt(row.startsAt)}</td>
                <td>{termCell(row)}</td>
                <td>{row.byNick || "—"}</td>
                <td>{fmt(row.grantedAt)}</td>
                <td className={row.note ? undefined : "muted"} title={row.note || undefined}>
                  {row.note || "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void revoke(row.steamId)}
                  >
                    Снять
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-pager">
        <p className="muted" style={{ margin: 0 }}>
          {filtered.length} из {rows.length}
          {q.trim() ? ` · «${q.trim()}»` : ""} · стр. {safePage}/{pageCount} · по{" "}
          {ADMIN_PAGE_SIZE} · QueuePriority
        </p>
        <div className="admin-pager-btns">
          <button
            type="button"
            className="btn"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ←
          </button>
          <button
            type="button"
            className="btn"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}

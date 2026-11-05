"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type FactionRow = {
  id: string;
  name: string;
  href: string;
  logoUrl: string | null;
  leaderNick: string;
  members: number;
};

type Person = { id: string; nick: string; name: string };

export function ClanFactionsPanel({ clanId }: { clanId: string }) {
  const [rows, setRows] = useState<FactionRow[]>([]);
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clans/${clanId}/factions`);
    if (!res.ok) {
      setError("Список фракций не открылся");
      return;
    }
    const data = (await res.json()) as { factions: FactionRow[]; candidates: Person[] };
    setRows(data.factions || []);
    setCandidates(data.candidates || []);
    setError("");
  }, [clanId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createFaction() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/clans/${clanId}/factions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leaderUserId: leaderId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; href?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Не создалось");
      return;
    }
    setName("");
    setLeaderId("");
    await load();
    if (data.href) window.location.href = data.href;
  }

  async function deleteFaction(row: FactionRow) {
    if (!window.confirm(`Удалить фракцию «${row.name}»? Состав и роли пропадут.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(
      `/api/clans/${clanId}/factions?factionId=${encodeURIComponent(row.id)}`,
      { method: "DELETE" }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Не удалилось");
      return;
    }
    await load();
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Фракции</h2>
      <p className="muted">
        Вкладка видна только тебе. Глава и зам открывают свою страницу по прямой ссылке, в этом списке их нет.
      </p>
      <div className="clan-invite-row">
        <input
          value={name}
          placeholder="Название фракции"
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
        <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
          <option value="">Глава из клана</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nick}
              {p.name ? ` (${p.name})` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={busy || name.trim().length < 2 || !leaderId}
          onClick={() => void createFaction()}
        >
          Создать фракцию
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="admin-table-wrap" style={{ marginTop: 16 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Фракция</th>
              <th>Глава</th>
              <th>В составе</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>Пока ни одной фракции.</td>
              </tr>
            ) : (
              rows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={f.href}>{f.name}</Link>
                  </td>
                  <td>{f.leaderNick}</td>
                  <td>{f.members}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void deleteFaction(f)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

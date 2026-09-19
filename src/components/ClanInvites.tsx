"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Invite = {
  id: string;
  clan: { id: string; name: string; tag: string; logoUrl: string | null };
  inviter: { nick: string | null };
};

export function ClanInvites({ initial }: { initial: Invite[] }) {
  const router = useRouter();
  const [invites, setInvites] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/clans/invites", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInvites(data.invites || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/live/me");
      es.addEventListener("user", () => {
        void reload();
        router.refresh();
      });
    } catch {
      /* */
    }
    const id = window.setInterval(() => void reload(), 10000);
    return () => {
      es?.close();
      window.clearInterval(id);
    };
  }, [reload, router]);

  async function act(inviteId: string, action: "accept" | "decline") {
    setError("");
    setLoading(inviteId);
    try {
      const res = await fetch("/api/clans/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Ошибка");
        return;
      }
      setInvites((list) => list.filter((i) => i.id !== inviteId));
      if (action === "accept" && data.clanId) {
        router.push(`/clans/${data.clanId}`);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(null);
    }
  }

  if (invites.length === 0) return null;

  return (
    <section className="card">
      <h2>Приглашения в клан</h2>
      {error ? <p className="error">{error}</p> : null}
      <ul className="invite-list">
        {invites.map((inv) => (
          <li key={inv.id} className="invite-row">
            <div>
              <strong>
                [{inv.clan.tag}] {inv.clan.name}
              </strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                от {inv.inviter.nick || "игрока"}
              </p>
            </div>
            <div className="avatar-actions">
              <button
                type="button"
                className="btn primary"
                disabled={loading === inv.id}
                onClick={() => void act(inv.id, "accept")}
              >
                Принять
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={loading === inv.id}
                onClick={() => void act(inv.id, "decline")}
              >
                Отклонить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

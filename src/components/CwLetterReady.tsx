"use client";

import { useEffect, useState } from "react";

type State = {
  ready: string[];
  going: boolean;
  open: boolean;
};

export function CwLetterReady({ matchId }: { matchId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    void fetch(`/api/cw-ready?matchId=${encodeURIComponent(matchId)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("skip");
        return (await res.json()) as State;
      })
      .then((data) => {
        if (!stop) setState(data);
      })
      .catch(() => {
        if (!stop) setState(null);
      });
    return () => {
      stop = true;
    };
  }, [matchId]);

  if (!state) return null;

  async function toggle() {
    if (busy || !state.open) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/cw-ready", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        going?: boolean;
        ready?: string[];
        error?: string;
      };
      if (!res.ok) {
        setErr(data.error || "Не вышло записать");
        return;
      }
      setState((cur) =>
        cur
          ? {
              ...cur,
              going: Boolean(data.going),
              ready: data.ready || [],
            }
          : cur
      );
    } catch {
      setErr("Нет связи");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-mail-cw">
      <p className="profile-mail-cw-title">Кто будет</p>
      {state.ready.length ? (
        <ol className="profile-mail-cw-list">
          {state.ready.map((nick, i) => (
            <li key={`${nick}-${i}`}>{nick}</li>
          ))}
        </ol>
      ) : (
        <p className="profile-mail-cw-empty">Пока никто не отметился</p>
      )}
      {state.open ? (
        <button
          type="button"
          className={`home-cw-go${state.going ? " is-on" : ""}`}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {state.going ? "Участие подтверждено" : "БУДУ НА КВ"}
        </button>
      ) : (
        <p className="profile-mail-cw-empty">Этой встречи уже нет в расписании</p>
      )}
      {err ? <p className="profile-mail-cw-err">{err}</p> : null}
    </div>
  );
}

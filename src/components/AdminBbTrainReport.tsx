"use client";

import { useEffect, useState } from "react";
import { CLAN_REAL_LABEL, clanMissingApprox } from "@/lib/bbClanHeadcount";
import type { BbTrainReportRow, BbTrainSlot } from "@/lib/bbTrainReport";
import { downloadBbTrainReportPng } from "@/lib/bbTrainReportPng";
import "@/app/bb-report/bb-report.css";

type Payload = {
  dates: string[];
  date: string;
  slot: BbTrainSlot;
  report: BbTrainReportRow | null;
};

/** Момент среза по тренировочному дню, мс UTC. 01:00 — уже следующее утро. */
function slotAtMs(date: string, slot: BbTrainSlot): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return 0;
  if (slot === "2130") return Date.UTC(y, m - 1, d, 18, 30, 0);
  return Date.UTC(y, m - 1, d, 22, 0, 0);
}

function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function Chips({ names }: { names: string[] }) {
  if (!names.length) return <p className="bb-admin-report-none">—</p>;
  return (
    <div className="bb-admin-report-chips">
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>{name}</span>
      ))}
    </div>
  );
}

export function AdminBbTrainReport() {
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<BbTrainSlot>("0100");
  const [row, setRow] = useState<BbTrainReportRow | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    q.set("slot", slot);
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/bb-train-report?${q.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as Payload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
        if (cancel) return;
        setErr(null);
        setRow(json.report);
        if (!date && json.date) setDate(json.date);
        setReady(true);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : "Ошибка");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [date, slot, reload]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const p = row?.payload;
  const when = slot === "2130" ? "21:30" : "01:00";
  const leftMs = date ? slotAtMs(date, slot) - nowMs : 0;
  const counting = leftMs > 0;

  useEffect(() => {
    if (!date) return;
    const target = slotAtMs(date, slot);
    if (Date.now() >= target) return;
    const timer = window.setInterval(() => {
      if (Date.now() < target) return;
      window.clearInterval(timer);
      window.setTimeout(() => setReload((n) => n + 1), 2000);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [date, slot]);

  return (
    <div className="bb-admin-report">
      <div className="bb-admin-report-bar">
        <input
          type="date"
          value={date}
          aria-label="День"
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
        <button
          type="button"
          className={slot === "2130" ? "is-on" : ""}
          onClick={() => setSlot("2130")}
        >
          21:30
        </button>
        <button
          type="button"
          className={slot === "0100" ? "is-on" : ""}
          onClick={() => setSlot("0100")}
        >
          01:00
        </button>
        {date ? (
          <span className="bb-admin-report-when">
            {date.split("-").reverse().join(".")} · {when}
            {counting && !row ? (
              <b className="bb-admin-report-count">через {formatLeft(leftMs)}</b>
            ) : null}
          </span>
        ) : null}
        <button
          type="button"
          className="bb-admin-report-png"
          disabled={!row}
          onClick={() => {
            if (row && date) void downloadBbTrainReportPng(row, date, slot);
          }}
        >
          Скачать PNG
        </button>
      </div>

      {err ? <p className="bb-admin-report-none">{err}</p> : null}
      {!err && ready && !row ? (
        <p className="bb-admin-report-none">
          {counting
            ? `Срез в ${when}. Осталось ${formatLeft(leftMs)}`
            : "За этот день среза ещё нет"}
        </p>
      ) : null}

      {row && p ? (
        <>
          <div className="bb-admin-report-stats bb-admin-report-stats-3">
            <div className="bb-admin-report-stat is-purple">
              <span>Пиковый онлайн сегодня</span>
              <strong>{row.peakOnline}</strong>
            </div>
            <div className="bb-admin-report-stat is-green">
              <span>Общее кол-во людей зашедших на тренировку сегодня</span>
              <strong>{row.joinedTotal}</strong>
            </div>
            <div className="bb-admin-report-stat is-orange">
              <span>На сервере, в клане нет</span>
              <strong>{p.notInClan.length}</strong>
            </div>
          </div>
          <div className="bb-admin-report-stats bb-admin-report-stats-3">
            <div className="bb-admin-report-stat is-blue">
              <span>Всего людей в клане на сайте</span>
              <strong>{p.clanOnSite || "—"}</strong>
            </div>
            <div className="bb-admin-report-stat is-gold">
              <span>Реально людей в клане</span>
              <strong>{CLAN_REAL_LABEL}</strong>
            </div>
            <div className="bb-admin-report-stat is-rose">
              <span>Не хватает</span>
              <strong>{clanMissingApprox(p.clanOnSite)}</strong>
            </div>
          </div>

          <section className="bb-admin-report-block is-orange">
            <h2>Были на сервере, в клане на сайте нет ({p.notInClan.length})</h2>
            <Chips names={p.notInClan} />
          </section>
          <section className="bb-admin-report-block is-slate">
            <h2>Резерв или выходной, сегодня нет ({p.excusedAbsent.length})</h2>
            <Chips names={p.excusedAbsent} />
          </section>

          <div className="bb-admin-report-stats bb-admin-report-stats-2">
            <div className="bb-admin-report-stat is-amber">
              <span>Вчера были, сегодня нет</span>
              <strong>{row.ydayMissingN}</strong>
            </div>
            <div className="bb-admin-report-stat is-red">
              <span>За неделю были, вчера нет</span>
              <strong>{row.weekMissingN}</strong>
            </div>
          </div>

          <section className="bb-admin-report-block is-amber">
            <h2>
              Вчера ({p.yday}) были — сегодня нет ({row.ydayMissingN})
            </h2>
            <Chips names={p.ydayMissing} />
          </section>
          <section className="bb-admin-report-block is-red">
            <h2>
              За неделю были, вчера нет ({row.weekMissingN})
            </h2>
            <Chips names={p.weekMissing} />
          </section>
          <section className="bb-admin-report-block is-purple">
            <h2>
              Первый заход после 21:30 — перезаход не считается ({row.lateFirstN})
            </h2>
            <Chips names={p.lateFirst} />
          </section>
          <section className="bb-admin-report-block is-pink">
            <h2>Кого не было больше недели ({p.absentOverWeek.length})</h2>
            <Chips names={p.absentOverWeek} />
          </section>
          <section className="bb-admin-report-block is-slate">
            <h2>В клане на сайте, в строках выше их нет ({p.neverSeen.length})</h2>
            <Chips names={p.neverSeen} />
          </section>
        </>
      ) : null}
    </div>
  );
}

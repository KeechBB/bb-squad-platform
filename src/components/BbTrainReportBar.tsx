"use client";

import { useRouter } from "next/navigation";

type Props = {
  date: string;
  slot: "2130" | "0100";
};

export function BbTrainReportBar({ date, slot }: Props) {
  const router = useRouter();

  function go(nextDate: string, nextSlot: string) {
    const q = new URLSearchParams({ date: nextDate, slot: nextSlot });
    router.push(`/bb-report?${q.toString()}`);
  }

  return (
    <div className="bb-report-bar">
      <input
        type="date"
        value={date}
        aria-label="День"
        onChange={(e) => {
          if (e.target.value) go(e.target.value, slot);
        }}
      />
      <button
        type="button"
        className={slot === "2130" ? "is-on" : ""}
        onClick={() => go(date, "2130")}
      >
        21:30
      </button>
      <button
        type="button"
        className={slot === "0100" ? "is-on" : ""}
        onClick={() => go(date, "0100")}
      >
        01:00
      </button>
    </div>
  );
}

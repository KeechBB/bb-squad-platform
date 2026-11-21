"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type ClanListItem = {
  id: string;
  tag: string;
  name: string;
  logoUrl: string | null;
  members: number;
  leaderNick: string | null;
};

type SortMode = "alpha" | "members";

type Props = {
  clans: ClanListItem[];
};

function sortKeyAlpha(c: ClanListItem) {
  return `${c.tag} ${c.name}`.toLocaleLowerCase("ru");
}

export function ClansListClient({ clans }: Props) {
  const [sort, setSort] = useState<SortMode>("alpha");

  const sorted = useMemo(() => {
    const list = [...clans];
    if (sort === "members") {
      list.sort((a, b) => {
        if (b.members !== a.members) return b.members - a.members;
        return sortKeyAlpha(a).localeCompare(sortKeyAlpha(b), "ru");
      });
    } else {
      list.sort((a, b) => sortKeyAlpha(a).localeCompare(sortKeyAlpha(b), "ru"));
    }
    return list;
  }, [clans, sort]);

  return (
    <div className="clan-list-wrap">
      <div className="clan-list-toolbar">
        <span className="muted clan-list-toolbar-label">Сортировка</span>
        <div
          className="attend-mode-toggle"
          role="group"
          aria-label="Сортировка кланов"
        >
          <button
            type="button"
            className={sort === "alpha" ? "active" : ""}
            onClick={() => setSort("alpha")}
          >
            По алфавиту
          </button>
          <button
            type="button"
            className={sort === "members" ? "active" : ""}
            onClick={() => setSort("members")}
          >
            По численности
          </button>
        </div>
      </div>

      <div className="clan-list">
        {sorted.map((c) => (
          <Link key={c.id} className="clan-row" href={`/clans/${c.id}`}>
            {c.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="clan-row-logo"
                src={c.logoUrl}
                alt=""
                width={48}
                height={48}
              />
            ) : (
              <div className="clan-row-logo clan-row-logo-empty">
                {c.tag.slice(0, 2)}
              </div>
            )}
            <div className="clan-row-body">
              <strong>
                [{c.tag}] {c.name}
              </strong>
              <span className="muted">
                Глава: {c.leaderNick || "—"} · игроков: {c.members}
              </span>
            </div>
            <span className="clan-row-arrow">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

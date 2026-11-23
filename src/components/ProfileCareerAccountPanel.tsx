"use client";

import { useEffect, useState } from "react";
import { ProfileCareerCard } from "@/components/ProfileCareerCard";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { ProfileAccountCard } from "@/components/ProfileAccountCard";
import {
  ProfileBpLevelPanel,
  bpTier,
  type ProfileBpView,
} from "@/components/ProfileBpLevelPanel";

type AccountInitial = {
  nick: string;
  discordTag: string | null;
  discordId: string | null;
  telegram: string | null;
  steamId: string;
  steamName: string | null;
  siteRole: string;
  regNo: number | null;
  clans: {
    id: string;
    tag: string;
    name: string;
    logoUrl: string | null;
    membershipLabel: string;
  }[];
};

type Props = {
  nick: string;
  account: AccountInitial;
  /** Чужой профиль — только просмотр анкеты, без «Изменить». */
  readOnly?: boolean;
};

type Panel = "career" | "account" | "bp";

export function ProfileCareerAccountPanel({ nick, account, readOnly = false }: Props) {
  const [panel, setPanel] = useState<Panel>("career");
  const [bp, setBp] = useState<ProfileBpView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/bp?nick=${encodeURIComponent(nick)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProfileBpView | null) => {
        if (cancelled || !data || typeof data.level !== "number") return;
        setBp(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [nick]);

  const tier = bpTier(bp?.done ? 20 : bp?.level || 1);

  return (
    <section className="profile-career-account card">
      <div className="profile-career-account-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panel === "career"}
          className={panel === "career" ? "is-active" : ""}
          onClick={() => setPanel("career")}
        >
          {readOnly ? "Карьера" : "Моя карьера"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "account"}
          className={panel === "account" ? "is-active" : ""}
          onClick={() => setPanel("account")}
        >
          Аккаунт
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "bp"}
          className={`is-bp-tab${panel === "bp" ? " is-active" : ""}`}
          data-tier={tier}
          onClick={() => setPanel("bp")}
        >
          Уровень BP
        </button>
      </div>
      <div className="profile-career-account-body">
        {panel === "career" ? (
          <ProfileCareerCard nick={nick} self={!readOnly} embedded />
        ) : panel === "account" ? (
          readOnly ? (
            <ProfileAccountCard
              data={{
                nick: account.nick,
                regNo: account.regNo,
                siteRole: account.siteRole || "Игрок",
                discordTag: account.discordTag,
                discordId: account.discordId,
                telegram: account.telegram,
                steamId: account.steamId,
                steamName: account.steamName,
                clans: account.clans,
              }}
            />
          ) : (
            <ProfileEditForm initial={account} />
          )
        ) : (
          <ProfileBpLevelPanel bp={bp} />
        )}
      </div>
    </section>
  );
}

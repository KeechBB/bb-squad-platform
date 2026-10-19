"use client";

import { useState } from "react";
import { ProfileCareerCard } from "@/components/ProfileCareerCard";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { AbsencePanel } from "@/components/AbsencePanel";

type AccountInitial = {
  nick: string;
  name: string;
  birthDate: string | null;
  age: number | null;
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
  reserveActive: boolean;
  reserveUntilLabel: string | null;
  reserveReason: string | null;
  dayOffActive: boolean;
  dayOffUntilLabel: string | null;
  dayOffReason: string | null;
};

type Panel = "career" | "account";

export function ProfileCareerAccountPanel({
  nick,
  account,
  reserveActive,
  reserveUntilLabel,
  reserveReason,
  dayOffActive,
  dayOffUntilLabel,
  dayOffReason,
}: Props) {
  const [panel, setPanel] = useState<Panel>("career");

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
          Моя карьера
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "account"}
          className={panel === "account" ? "is-active" : ""}
          onClick={() => setPanel("account")}
        >
          Аккаунт / статус
        </button>
      </div>
      <div className="profile-career-account-body">
        {panel === "career" ? (
          <ProfileCareerCard nick={nick} self embedded />
        ) : (
          <>
            <AbsencePanel
              reserveActive={reserveActive}
              reserveUntilLabel={reserveUntilLabel}
              reserveReason={reserveReason}
              dayOffActive={dayOffActive}
              dayOffUntilLabel={dayOffUntilLabel}
              dayOffReason={dayOffReason}
            />
            <ProfileEditForm initial={account} />
          </>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AvatarEditor } from "@/components/AvatarEditor";
import { ClanInvites } from "@/components/ClanInvites";
import { AdminPanelLink } from "@/components/AdminPanelLink";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { ProfileKitsCard } from "@/components/ProfileKitsCard";
import { ProfileCareerCard } from "@/components/ProfileCareerCard";
import { AbsencePanel } from "@/components/AbsencePanel";
import { ProfileClientHydrate } from "@/components/ProfileClientHydrate";
import { prefetchProfileView } from "@/lib/profileViewCache";

type Shell = {
  id: string;
  nick: string | null;
  name: string | null;
  avatarUrl: string | null;
  steamAvatar: string | null;
  lastSeenAt: string | Date | null;
  admin: boolean;
  isBb: boolean;
  kitsLane: "TR1" | "PB1";
  birthDate: string | null;
  age: number | null;
  discordTag: string | null;
  discordId: string | null;
  telegram: string | null;
  steamId: string;
  steamName: string | null;
  siteRole: string;
  regNo: number | null;
  reserveActive: boolean;
  reserveUntilLabel: string | null;
  reserveReason: string | null;
  dayOffActive: boolean;
  dayOffUntilLabel: string | null;
  dayOffReason: string | null;
  invites: {
    id: string;
    clan: { id: string; name: string; tag: string; logoUrl: string | null };
    inviter: { nick: string | null };
  }[];
  clans: {
    id: string;
    tag: string;
    name: string;
    logoUrl: string | null;
    membershipLabel: string;
  }[];
};

const SHELL_CACHE_KEY = "bb_profile_shell_v1";

function readShellCache(): Shell | null {
  try {
    const raw = sessionStorage.getItem(SHELL_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Shell;
  } catch {
    return null;
  }
}

function writeShellCache(data: Shell) {
  try {
    sessionStorage.setItem(SHELL_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function ProfilePageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [shell, setShell] = useState<Shell | null>(() =>
    typeof window !== "undefined" ? readShellCache() : null
  );
  const [error, setError] = useState<string | null>(null);

  // Shell сразу — не ждём useSession (он мог держать «Открываю профиль…»)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/profile/shell", {
          credentials: "same-origin",
        });
        if (res.status === 401) {
          if (!cancelled) router.replace("/?login=1");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Shell;
        if (cancelled) return;
        writeShellCache(data);
        setShell(data);
        setError(null);
        if (data.nick) prefetchProfileView(data.nick);
      } catch {
        if (!cancelled && !readShellCache()) {
          setError("Не удалось загрузить профиль");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?login=1");
    } else if (
      status === "authenticated" &&
      session &&
      !session.user.profileComplete
    ) {
      router.replace("/register");
    }
  }, [status, session, router]);

  if (!shell && !error) {
    return (
      <main className="profile-page">
        <div className="card" style={{ padding: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            Открываю профиль…
          </p>
        </div>
      </main>
    );
  }

  if (error || !shell) {
    return (
      <main className="profile-page">
        <div className="card" style={{ padding: 16 }}>
          <p className="error" style={{ margin: 0 }}>
            {error || "Ошибка"}
          </p>
        </div>
      </main>
    );
  }

  const nickForKv = shell.nick || session?.user?.nick || "";

  return (
    <main className="profile-page">
      <div className="profile-area-head">
        <div className="profile-head-cluster">
          <div className="profile-head-main">
            <AvatarEditor
              nick={shell.nick || session?.user?.nick || "Игрок"}
              name={shell.name || session?.user?.name || ""}
              initialAvatar={shell.avatarUrl}
              steamAvatar={shell.steamAvatar}
              adminLink={<AdminPanelLink initialAdmin={shell.admin} />}
              lastSeenAt={
                shell.lastSeenAt ? new Date(shell.lastSeenAt) : null
              }
            />
            <AbsencePanel
              reserveActive={shell.reserveActive}
              reserveUntilLabel={shell.reserveUntilLabel}
              reserveReason={shell.reserveReason}
              dayOffActive={shell.dayOffActive}
              dayOffUntilLabel={shell.dayOffUntilLabel}
              dayOffReason={shell.dayOffReason}
            />
            {nickForKv ? (
              <ProfileClientHydrate nick={nickForKv} slot="head" />
            ) : null}
            <ProfileKitsCard
              userId={shell.id}
              allowTr1={shell.isBb}
              initialLane={shell.kitsLane}
            />
            <ClanInvites initial={shell.invites} />
          </div>
          {nickForKv ? <ProfileCareerCard nick={nickForKv} self /> : null}
        </div>
      </div>

      <div className="profile-area-account">
        <ProfileEditForm
          initial={{
            nick: shell.nick || "",
            name: shell.name || "",
            birthDate: shell.birthDate,
            age: shell.age,
            discordTag: shell.discordTag,
            discordId: shell.discordId,
            telegram: shell.telegram,
            steamId: shell.steamId,
            steamName: shell.steamName,
            siteRole: shell.siteRole,
            regNo: shell.regNo,
            clans: shell.clans,
          }}
        />
        {nickForKv ? (
          <ProfileClientHydrate nick={nickForKv} slot="stats" />
        ) : null}
      </div>

      <div className="profile-area-hitmap">
        <ProfileHitmapCard
          userId={shell.id}
          nick={nickForKv || shell.nick || undefined}
          subtitle="TR1+TR2"
          matchHistory={[]}
        />
      </div>

      <div className="profile-area-training">
        <ProfileClientHydrate
          nick={nickForKv || shell.nick || ""}
          slot="training"
        />
      </div>

      {nickForKv ? (
        <ProfileClientHydrate
          nick={nickForKv}
          slot="histories"
          defaultHistTab={shell.isBb ? "train" : "public"}
        />
      ) : null}
    </main>
  );
}

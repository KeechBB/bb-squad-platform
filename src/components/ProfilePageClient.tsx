"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AvatarEditor } from "@/components/AvatarEditor";
import { ClanInvites } from "@/components/ClanInvites";
import { AdminPanelLink } from "@/components/AdminPanelLink";
import { AbsencePanel } from "@/components/AbsencePanel";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { ProfileKitsCard } from "@/components/ProfileKitsCard";
import { ProfileCareerAccountPanel } from "@/components/ProfileCareerAccountPanel";
import { ProfileClientHydrate } from "@/components/ProfileClientHydrate";
import {
  ProfileModeSwitch,
  type ProfileMode,
} from "@/components/ProfileModeSwitch";
import { ProfileBgPicker } from "@/components/ProfileBgPicker";
import { ProfileMedalShelf } from "@/components/ProfileMedalShelf";
import { prefetchProfileView } from "@/lib/profileViewCache";
import {
  normalizeProfileBg,
  profileBgUrl,
  type ProfileBgId,
} from "@/lib/profileBg";
import type { ProfileMedalItem } from "@/lib/profileMedals";

type Shell = {
  id: string;
  nick: string | null;
  name: string | null;
  avatarUrl: string | null;
  steamAvatar: string | null;
  profileBg?: ProfileBgId | null;
  medals?: ProfileMedalItem[];
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

const SHELL_CACHE_KEY = "bb_profile_shell_v2";
const MODE_KEY = "bb_profile_mode_v1";

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

function readMode(isBb: boolean): ProfileMode {
  try {
    const raw = sessionStorage.getItem(MODE_KEY);
    if (raw === "public" || raw === "train" || raw === "cw") return raw;
  } catch {
    /* ignore */
  }
  return isBb ? "train" : "public";
}

export function ProfilePageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [shell, setShell] = useState<Shell | null>(() =>
    typeof window !== "undefined" ? readShellCache() : null
  );
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ProfileMode>(() =>
    typeof window !== "undefined" && shell
      ? readMode(shell.isBb)
      : "train"
  );
  const [savedBg, setSavedBg] = useState<ProfileBgId | null>(() =>
    normalizeProfileBg(shell?.profileBg)
  );
  const [previewBg, setPreviewBg] = useState<ProfileBgId | null>(() =>
    normalizeProfileBg(shell?.profileBg)
  );

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
        setMode(readMode(data.isBb));
        const bg = normalizeProfileBg(data.profileBg);
        setSavedBg(bg);
        setPreviewBg(bg);
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

  useEffect(() => {
    const shellEl = document.querySelector(".shell") as HTMLElement | null;
    if (!shellEl) return;
    const url = profileBgUrl(previewBg);
    if (url) {
      shellEl.style.setProperty("--profile-bg-image", `url(${url})`);
      shellEl.classList.add("has-profile-bg");
    } else {
      shellEl.style.removeProperty("--profile-bg-image");
      shellEl.classList.remove("has-profile-bg");
    }
    return () => {
      shellEl.style.removeProperty("--profile-bg-image");
      shellEl.classList.remove("has-profile-bg");
    };
  }, [previewBg]);

  function changeMode(next: ProfileMode) {
    setMode(next);
    try {
      sessionStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  if (!shell && !error) {
    return (
      <main className="profile-page profile-page-v2">
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
      <main className="profile-page profile-page-v2">
        <div className="card" style={{ padding: 16 }}>
          <p className="error" style={{ margin: 0 }}>
            {error || "Ошибка"}
          </p>
        </div>
      </main>
    );
  }

  const nickForKv = shell.nick || session?.user?.nick || "";
  const kitsLane =
    mode === "public" ? "PB1" : shell.isBb ? "TR1" : shell.kitsLane;
  return (
    <main
      className="profile-page profile-page-v2"
      data-mode={mode}
      data-profile-bg={previewBg || undefined}
    >
      <div className="profile-v2-ident">
        <AvatarEditor
          nick={shell.nick || session?.user?.nick || "Игрок"}
          name={shell.name || session?.user?.name || ""}
          initialAvatar={shell.avatarUrl}
          steamAvatar={shell.steamAvatar}
          adminLink={<AdminPanelLink initialAdmin={shell.admin} />}
          lastSeenAt={shell.lastSeenAt ? new Date(shell.lastSeenAt) : null}
        />
        <ProfileBgPicker
          value={savedBg}
          onPreview={setPreviewBg}
          onSaved={(bg) => {
            setSavedBg(bg);
            setPreviewBg(bg);
            setShell((prev) => {
              if (!prev) return prev;
              const next = { ...prev, profileBg: bg };
              writeShellCache(next);
              return next;
            });
          }}
        />
        <ProfileModeSwitch value={mode} onChange={changeMode} />
        <ClanInvites initial={shell.invites} />
        <ProfileMedalShelf items={shell.medals || []} />
      </div>

      <div className="profile-v2-career">
        {nickForKv ? (
          <ProfileCareerAccountPanel
            nick={nickForKv}
            account={{
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
        ) : null}
      </div>

      <div className="profile-v2-attend">
        <ProfileClientHydrate
          nick={nickForKv || shell.nick || ""}
          slot="training"
          mode={mode}
          absenceSlot={
            <AbsencePanel
              compact
              reserveActive={shell.reserveActive}
              reserveUntilLabel={shell.reserveUntilLabel}
              reserveReason={shell.reserveReason}
              dayOffActive={shell.dayOffActive}
              dayOffUntilLabel={shell.dayOffUntilLabel}
              dayOffReason={shell.dayOffReason}
            />
          }
        />
      </div>

      <div className="profile-v2-stats">
        {nickForKv ? (
          <ProfileClientHydrate nick={nickForKv} slot="stats" mode={mode} />
        ) : null}
      </div>

      <div className="profile-v2-history">
        {nickForKv ? (
          <ProfileClientHydrate
            nick={nickForKv}
            slot="history"
            mode={mode}
            defaultHistTab={shell.isBb ? "train" : "public"}
          />
        ) : null}
      </div>

      <div className="profile-v2-roles">
        <ProfileKitsCard
          key={`${mode}-${kitsLane}`}
          userId={shell.id}
          allowTr1={shell.isBb && mode !== "public"}
          hideLaneToggle
          initialLane={kitsLane}
        />
      </div>

      <div className="profile-v2-hits">
        <ProfileHitmapCard
          userId={shell.id}
          nick={nickForKv || shell.nick || undefined}
          matchHistory={[]}
        />
      </div>
    </main>
  );
}

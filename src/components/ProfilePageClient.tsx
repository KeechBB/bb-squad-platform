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
import { ProfileV2ScaleStage } from "@/components/ProfileV2ScaleStage";
import { prefetchProfileView } from "@/lib/profileViewCache";
import {
  normalizeProfileBg,
  profileBgUrl,
  type ProfileBgChoice,
  type ProfileBgId,
} from "@/lib/profileBg";
import {
  normalizeProfilePatch,
  type ProfilePatchChoice,
  type ProfilePatchId,
} from "@/lib/profilePatches";
import {
  normalizeProfileNickStyle,
  type ProfileNickStyleChoice,
  type ProfileNickStyleId,
} from "@/lib/profileNickStyles";
import type { ProfileMedalItem } from "@/lib/profileMedals";

type Shell = {
  id: string;
  nick: string | null;
  name: string | null;
  avatarUrl: string | null;
  steamAvatar: string | null;
  profileBg?: ProfileBgId | null;
  profileBgChoices?: ProfileBgChoice[];
  nickPatch?: ProfilePatchId | null;
  profilePatchChoices?: ProfilePatchChoice[];
  nickStyle?: ProfileNickStyleId | null;
  profileNickStyleChoices?: ProfileNickStyleChoice[];
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

const SHELL_CACHE_KEY = "bb_profile_shell_v6";
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

export function ProfilePageClient({ subjectNick }: { subjectNick?: string } = {}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const readOnly = Boolean(subjectNick);
  const [shell, setShell] = useState<Shell | null>(() =>
    typeof window !== "undefined" && !subjectNick ? readShellCache() : null
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
  const [savedPatch, setSavedPatch] = useState<ProfilePatchId | null>(() =>
    normalizeProfilePatch(shell?.nickPatch)
  );
  const [savedNickStyle, setSavedNickStyle] =
    useState<ProfileNickStyleId | null>(() =>
      normalizeProfileNickStyle(shell?.nickStyle)
    );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          subjectNick
            ? `/api/profile/shell?nick=${encodeURIComponent(subjectNick)}`
            : "/api/profile/shell",
          { credentials: "same-origin" }
        );
        if (res.status === 401) {
          if (!cancelled) router.replace("/?login=1");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Shell;
        if (cancelled) return;
        if (!subjectNick) writeShellCache(data);
        setShell(data);
        setMode(readMode(data.isBb));
        const bg = normalizeProfileBg(data.profileBg);
        setSavedBg(bg);
        setPreviewBg(bg);
        setSavedPatch(normalizeProfilePatch(data.nickPatch));
        setSavedNickStyle(normalizeProfileNickStyle(data.nickStyle));
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
  }, [router, subjectNick]);

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
    const body = document.body;
    const url = profileBgUrl(previewBg);
    if (url) {
      body.style.setProperty("--profile-bg-image", `url(${url})`);
      body.classList.add("has-profile-bg");
    } else {
      body.style.removeProperty("--profile-bg-image");
      body.classList.remove("has-profile-bg");
    }
    return () => {
      body.style.removeProperty("--profile-bg-image");
      body.classList.remove("has-profile-bg");
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
      <ProfileV2ScaleStage>
        <main className="profile-page profile-page-v2">
          <div className="card" style={{ padding: 16 }}>
            <p className="muted" style={{ margin: 0 }}>
              Открываю профиль…
            </p>
          </div>
        </main>
      </ProfileV2ScaleStage>
    );
  }

  if (error || !shell) {
    return (
      <ProfileV2ScaleStage>
        <main className="profile-page profile-page-v2">
          <div className="card" style={{ padding: 16 }}>
            <p className="error" style={{ margin: 0 }}>
              {error || "Ошибка"}
            </p>
          </div>
        </main>
      </ProfileV2ScaleStage>
    );
  }

  const nickForKv = shell.nick || session?.user?.nick || "";
  const kitsLane =
    mode === "public" ? "PB1" : shell.isBb ? "TR1" : shell.kitsLane;
  return (
    <ProfileV2ScaleStage hasBg={Boolean(previewBg)}>
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
          adminLink={
            readOnly ? undefined : <AdminPanelLink initialAdmin={shell.admin} />
          }
          lastSeenAt={shell.lastSeenAt ? new Date(shell.lastSeenAt) : null}
          readOnly={readOnly}
        />
        {readOnly ? null : (
        <ProfileBgPicker
          options={
            Array.isArray(shell.profileBgChoices)
              ? shell.profileBgChoices
              : []
          }
          patchOptions={
            Array.isArray(shell.profilePatchChoices)
              ? shell.profilePatchChoices
              : []
          }
          nickStyleOptions={
            Array.isArray(shell.profileNickStyleChoices)
              ? shell.profileNickStyleChoices
              : []
          }
          value={savedBg}
          patchValue={savedPatch}
          nickStyleValue={savedNickStyle}
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
          onPatchSaved={(patch) => {
            setSavedPatch(patch);
            setShell((prev) => {
              if (!prev) return prev;
              const next = { ...prev, nickPatch: patch };
              writeShellCache(next);
              return next;
            });
          }}
          onNickStyleSaved={(nickStyle) => {
            setSavedNickStyle(nickStyle);
            setShell((prev) => {
              if (!prev) return prev;
              const next = { ...prev, nickStyle };
              writeShellCache(next);
              return next;
            });
          }}
        />
        )}
        <ProfileModeSwitch value={mode} onChange={changeMode} />
        {readOnly ? null : <ClanInvites initial={shell.invites} />}
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
            readOnly ? null : (
            <AbsencePanel
              compact
              reserveActive={shell.reserveActive}
              reserveUntilLabel={shell.reserveUntilLabel}
              reserveReason={shell.reserveReason}
              dayOffActive={shell.dayOffActive}
              dayOffUntilLabel={shell.dayOffUntilLabel}
              dayOffReason={shell.dayOffReason}
            />
            )
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
    </ProfileV2ScaleStage>
  );
}

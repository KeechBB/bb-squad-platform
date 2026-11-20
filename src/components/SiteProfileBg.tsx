"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  normalizeProfileBg,
  profileBgUrl,
  type ProfileBgId,
} from "@/lib/profileBg";

const EVENT = "bb-site-profile-bg";
const STORAGE_KEY = "bb_site_profile_bg_v1";

export function broadcastSiteProfileBg(bg: ProfileBgId | null) {
  const id = normalizeProfileBg(bg);
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { bg: id } }));
  }
}

function pathAllowsSiteBg(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return false;
  if (pathname === "/battle-pass" || pathname.startsWith("/battle-pass/")) {
    return false;
  }
  return true;
}

type Props = {
  initialBgId?: string | null;
};

/** Тест: выбранный фон профиля на всём сайте, кроме главной и Battle Pass. */
export function SiteProfileBg({ initialBgId = null }: Props) {
  const pathname = usePathname() || "/";
  const [bgId, setBgId] = useState<ProfileBgId | null>(() =>
    normalizeProfileBg(initialBgId)
  );

  useEffect(() => {
    setBgId(normalizeProfileBg(initialBgId));
  }, [initialBgId]);

  useEffect(() => {
    try {
      const cached = normalizeProfileBg(localStorage.getItem(STORAGE_KEY));
      if (cached) setBgId(cached);
    } catch {
      /* ignore */
    }
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ bg?: unknown }>).detail;
      setBgId(normalizeProfileBg(detail?.bg));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setBgId(normalizeProfileBg(e.newValue));
    };
    window.addEventListener(EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    const allow = pathAllowsSiteBg(pathname);
    const url = allow ? profileBgUrl(bgId) : null;
    if (url) {
      body.style.setProperty("--site-profile-bg-image", `url(${url})`);
      body.classList.add("has-site-profile-bg");
    } else {
      body.style.removeProperty("--site-profile-bg-image");
      body.classList.remove("has-site-profile-bg");
    }
    return () => {
      body.style.removeProperty("--site-profile-bg-image");
      body.classList.remove("has-site-profile-bg");
    };
  }, [pathname, bgId]);

  return null;
}

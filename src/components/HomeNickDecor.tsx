"use client";

import Link from "next/link";
import { NickPatchMark } from "@/components/NickPatchMark";
import {
  normalizeProfileNickStyle,
  profileNickStyleCssClass,
} from "@/lib/profileNickStyles";

type Props = {
  nick: string;
  nickPatch?: string | null;
  nickStyle?: string | null;
  href?: string;
  className?: string;
};

/** Ник + стиль шрифта + нашивка (как в рейтингах). */
export function HomeNickDecor({
  nick,
  nickPatch = null,
  nickStyle = null,
  href,
  className = "home-attend-streaks-nick",
}: Props) {
  const styleId = normalizeProfileNickStyle(nickStyle);
  const styleClass = profileNickStyleCssClass(styleId);
  const hasStyle = Boolean(styleClass);
  const label = (
    <span
      className={`home-nick-label${styleClass ? ` ${styleClass}` : ""}`}
      data-text={hasStyle ? nick : undefined}
    >
      {nick}
    </span>
  );

  return (
    <span className="home-nick-decor">
      {href ? (
        <Link
          className={`${className}${hasStyle ? " has-custom-nick-style" : ""}`}
          href={href}
          title={nick}
        >
          {label}
        </Link>
      ) : (
        <span
          className={`${className}${hasStyle ? " has-custom-nick-style" : ""}`}
          title={nick}
        >
          {label}
        </span>
      )}
      <NickPatchMark patchId={nickPatch} className="home-nick-patch" />
    </span>
  );
}

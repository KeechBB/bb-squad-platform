"use client";

import Link from "next/link";
import {
  normalizeProfileNickStyle,
  profileNickStyleCssClass,
} from "@/lib/profileNickStyles";

type Props = {
  nick: string;
  nickStyle?: string | null;
  href?: string;
  className?: string;
};

/** Ник + стиль шрифта на топах главной. Нашивку здесь не показываем. */
export function HomeNickDecor({
  nick,
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
    </span>
  );
}

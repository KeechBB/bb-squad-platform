"use client";

import { useState, type ReactNode } from "react";
import { isBareImageUrl, safeMailImgSrc } from "@/lib/mailImageSrc";
import { safeMailGoPath } from "@/lib/mailTags";

function MailShot({ src }: { src: string }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {src}
      </a>
    );
  }
  return (
    <img
      className="profile-mail-shot"
      src={src}
      alt=""
      onError={() => setBad(true)}
    />
  );
}

/** Текст письма: ссылки кликабельны, картинки садятся в ширину окна. */
export function MailBody({ text }: { text: string }) {
  const re =
    /\[\[img:([^\]]+)\]\]|\[\[go:(\/[^\|\]]+)\|([^\]]+)\]\]|(https?:\/\/[^\s<>"']+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      nodes.push(<span key={i++}>{text.slice(last, match.index)}</span>);
    }
    if (match[1]) {
      const src = safeMailImgSrc(match[1]);
      nodes.push(src ? <MailShot key={i++} src={src} /> : <span key={i++}>{match[0]}</span>);
    } else if (match[2] && match[3]) {
      const path = safeMailGoPath(match[2]);
      const label = String(match[3] || "")
        .trim()
        .replace(/[\[\]]/g, "")
        .slice(0, 40);
      if (path && label) {
        nodes.push(
          <a key={i++} className="profile-mail-go" href={path}>
            {label}
          </a>
        );
      } else {
        nodes.push(<span key={i++}>{match[0]}</span>);
      }
    } else if (match[4]) {
      const raw = match[4];
      const trailMatch = raw.match(/^(.*?)([),.!?:;]+)$/);
      const href = trailMatch ? trailMatch[1] : raw;
      const trail = trailMatch ? trailMatch[2] : "";
      const src = isBareImageUrl(href) ? safeMailImgSrc(href) : null;
      if (src) {
        nodes.push(<MailShot key={i++} src={src} />);
        if (trail) nodes.push(<span key={i++}>{trail}</span>);
      } else {
        nodes.push(
          <span key={i++}>
            <a href={href} target="_blank" rel="noopener noreferrer">
              {href}
            </a>
            {trail}
          </span>
        );
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(<span key={i++}>{text.slice(last)}</span>);
  return <>{nodes}</>;
}

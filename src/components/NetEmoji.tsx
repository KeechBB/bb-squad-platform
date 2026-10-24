"use client";

import { NET_EMOJI, netEmojiById, type NetEmoji } from "@/lib/netEmoji";

function Face({ item, size }: { item: NetEmoji; size: number }) {
  const m = item.mouth;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <ellipse cx="16" cy="18" rx="12" ry="11" fill={item.fill} />
      <path d="M16 6c2 0 3 2 2 4-2-1-4 0-5-1 1-2 2-3 3-3z" fill="#166534" />
      {m === "sleep" ? (
        <path d="M10 16h5M17 16h5" stroke="#1c1917" strokeWidth="1.4" strokeLinecap="round" />
      ) : m === "wink" ? (
        <>
          <path d="M9 16h5" stroke="#1c1917" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="21" cy="16" r="1.4" fill="#1c1917" />
        </>
      ) : m === "cool" ? (
        <path d="M8 16h6M18 16h6" stroke="#1c1917" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="12" cy="16" r="1.4" fill="#1c1917" />
          <circle cx="20" cy="16" r="1.4" fill="#1c1917" />
        </>
      )}
      {m === "smile" || m === "gg" || m === "party" ? (
        <path d="M11 20c1.6 2.2 8.4 2.2 10 0" stroke="#1c1917" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : null}
      {m === "laugh" ? (
        <path d="M11 19c1.4 3 8.6 3 10 0v2c-1.6 1.2-8.4 1.2-10 0z" fill="#1c1917" />
      ) : null}
      {m === "flat" || m === "think" ? (
        <path d="M12 21h8" stroke="#1c1917" strokeWidth="1.3" strokeLinecap="round" />
      ) : null}
      {m === "sad" || m === "cry" ? (
        <path d="M11 23c1.6-2 8.4-2 10 0" stroke="#1c1917" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : null}
      {m === "angry" ? (
        <path d="M11 21c2-1.4 8-1.4 10 0" stroke="#1c1917" strokeWidth="1.4" fill="none" />
      ) : null}
      {m === "wow" || m === "hype" ? <ellipse cx="16" cy="21" rx="2.2" ry="2.6" fill="#1c1917" /> : null}
      {m === "love" ? (
        <path d="M16 23c-3-2-5-4-3.2-5.6 1.2-1 2.4-.2 3.2.8.8-1 2-1.8 3.2-.8C21 19 19 21 16 23z" fill="#9f1239" />
      ) : null}
      {m === "shy" ? (
        <>
          <circle cx="9" cy="19" r="1.6" fill="#fecdd3" />
          <circle cx="23" cy="19" r="1.6" fill="#fecdd3" />
          <path d="M13 21h6" stroke="#1c1917" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : null}
      {m === "cry" ? <path d="M22 18c.4 2 .2 3-.4 4" stroke="#7dd3fc" strokeWidth="1.2" fill="none" /> : null}
      {m === "party" ? <circle cx="24" cy="10" r="2" fill="#fde047" /> : null}
      {m === "hype" ? <path d="M24 8l1 3 3 .4-2.4 1.8.8 2.8L24 14.4 21.6 16l.8-2.8L20 11.4l3-.4z" fill="#fde047" /> : null}
    </svg>
  );
}

export function NetMark({ id, size = 22 }: { id: string; size?: number }) {
  const item = netEmojiById(id);
  if (!item) return null;
  return (
    <span className="net-mark" title={`${item.label}: ${item.emotion}`}>
      <Face item={item} size={size} />
    </span>
  );
}

export function NetRichText({ text }: { text: string }) {
  const parts = text.split(/:([a-z0-9-]+):/g);
  return (
    <span className="net-rich">
      {parts.map((part, i) => {
        if (i % 2 === 1 && netEmojiById(part)) return <NetMark key={i} id={part} />;
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function NetEmojiBar({ onPick }: { onPick: (token: string) => void }) {
  return (
    <div className="net-emoji-bar" role="listbox" aria-label="Смайлы Фруктовый сад">
      {NET_EMOJI.map((item) => (
        <button
          key={item.id}
          type="button"
          className="net-emoji-btn"
          title={`${item.label}: ${item.emotion}`}
          onClick={() => onPick(`:${item.id}:`)}
        >
          <Face item={item} size={26} />
        </button>
      ))}
    </div>
  );
}

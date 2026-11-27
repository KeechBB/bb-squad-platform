"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FAQ_TOPICS, type FaqTopicId } from "@/lib/factionFaq";

function renderGuideLine(text: string): ReactNode {
  // *важное* → жёлтая пометка; иначе целиком как есть
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      return (
        <mark key={i} className="faction-guide-hi">
          {p.slice(1, -1)}
        </mark>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function FactionFaqPanel() {
  const [activeId, setActiveId] = useState<FaqTopicId>("mgmt");
  const active = useMemo(
    () => FAQ_TOPICS.find((t) => t.id === activeId) || FAQ_TOPICS[0],
    [activeId],
  );

  return (
    <div className="faction-faq faction-guide">
      <div className="faction-faq-head">
        <h3 className="xfer-title">✦ FAQ · справочная</h3>
        <p className="muted xfer-sub">
          Справа темы — ткни квадратик. Слева живое объяснение: что можно
          делать, за что получаете, когда и где.
        </p>
      </div>

      <div className="faction-faq-layout">
        <article className="faction-faq-detail" aria-live="polite">
          <h4 className="faction-faq-detail-title">{active.title}</h4>
          <p className="muted faction-faq-detail-blurb">{active.blurb}</p>
          <div className="faction-faq-detail-body">
            {active.body.map((p, i) => (
              <p key={`${active.id}-${i}`}>{renderGuideLine(p)}</p>
            ))}
          </div>
        </article>

        <aside className="faction-faq-tiles" aria-label="Темы FAQ">
          {FAQ_TOPICS.map((t) => {
            const on = t.id === active.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`faction-faq-tile${on ? " is-active" : ""}`}
                onClick={() => setActiveId(t.id)}
              >
                <span className="faction-faq-tile-title">{t.title}</span>
                <span className="faction-faq-tile-blurb">{t.blurb}</span>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

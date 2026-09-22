"use client";

import { useEffect, useRef, useState } from "react";

export function HomeMrapEgg() {
  const [hover, setHover] = useState(false);
  const [knock, setKnock] = useState(false);
  const knockTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (knockTimer.current != null) window.clearTimeout(knockTimer.current);
    };
  }, []);

  function onKnock() {
    setKnock(true);
    if (knockTimer.current != null) window.clearTimeout(knockTimer.current);
    knockTimer.current = window.setTimeout(() => {
      setKnock(false);
      knockTimer.current = null;
    }, 500);
  }

  const showHover = hover && !knock;

  return (
    <div className="home-mrap-egg">
      <button
        type="button"
        className="home-mrap-hotspot"
        aria-label="МРАП"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={onKnock}
      />

      {showHover ? (
        <div className="home-mrap-thought is-hover" role="status">
          тссс… где-то тут сидит Гадлер, не буди его
        </div>
      ) : null}

      {knock ? (
        <div className="home-mrap-thought is-knock" role="status">
          стук
        </div>
      ) : null}
    </div>
  );
}

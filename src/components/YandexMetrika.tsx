"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

declare global {
  interface Window {
    ym?: (
      id: number,
      method: string,
      ...args: unknown[]
    ) => void;
  }
}

function MetrikaHit({ id }: { id: number }) {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.ym !== "function") return;
    const qs = search?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.ym(id, "hit", url);
  }, [id, pathname, search]);

  return null;
}

/**
 * Yandex Metrika counter. Enabled when NEXT_PUBLIC_YANDEX_METRIKA_ID is set.
 * SPA hits on App Router navigations.
 */
export function YandexMetrika() {
  const raw = (process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID || "").trim();
  const id = Number(raw);
  if (!raw || !Number.isFinite(id) || id <= 0) return null;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">{`
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${id}", "ym");
ym(${id}, "init", {
  ssr: true,
  webvisor: true,
  clickmap: true,
  accurateTrackBounce: true,
  trackLinks: true
});
`}</Script>
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${id}`}
            style={{ position: "absolute", left: -9999 }}
            alt=""
          />
        </div>
      </noscript>
      <Suspense fallback={null}>
        <MetrikaHit id={id} />
      </Suspense>
    </>
  );
}

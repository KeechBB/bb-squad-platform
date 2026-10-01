import releasesData from "@/data/site-releases.json";

export type SiteRelease = {
  version: string;
  date: string;
  title: string;
  bullets: string[];
};

export type SiteReleasesFile = {
  current: string;
  releases: SiteRelease[];
};

export function getSiteReleases(): SiteReleasesFile {
  const data = releasesData as SiteReleasesFile;
  const releases = Array.isArray(data.releases) ? data.releases : [];
  return {
    current: String(data.current || "").trim() || "0.0.0",
    releases: [...releases].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return db.localeCompare(da);
      return compareSemver(b.version, a.version);
    }),
  };
}

export function getCurrentBetaLabel(): string {
  const { current } = getSiteReleases();
  return `Beta v${current}`;
}

/** Следующий патч: 1.1.36 → 1.1.37 */
export function nextPatchVersion(current: string): string {
  const parts = String(current)
    .trim()
    .split(".")
    .map((x) => Number(x));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    return "1.1.1";
  }
  parts[2] += 1;
  return parts.join(".");
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

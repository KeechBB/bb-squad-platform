# Project working context

Last reviewed: 2026-11-08. Initial source baseline: `61b3a04`.
Purpose: persistent English context for future development sessions. Update this
file as implementation and understanding change; keep history in the existing
journal/changelog rather than accumulating a transcript here.

## Product and stack

BlackBerry Squad is a Russian-language community platform for the game Squad,
serving BB members, other clans, and solo players. Existing functionality includes
Steam registration, player profiles, training/CW/public statistics, attendance,
clans and squads, factions, tournaments and bets, battle pass rewards, replay
viewing, reaction training, support chat, mail, and administration.
CW means clan war; TRAIN means training; PUBLIC means public-server matches.
RP is the rating subsystem; PWR is another displayed performance measure.

- Next.js 15.5.25 App Router, React 19.1, TypeScript with strict mode.
- NextAuth v4 with `next-auth-steam`; JWT sessions; Prisma 5 with PostgreSQL.
- npm and `package-lock.json`; README specifies Node 20+.
- Plain CSS and React components; Manrope/Oxanium fonts, Three.js/globe.gl for visuals.
- Python scripts handle collection, parsing, publishing, repairs, and rating builds.
- No Docker setup or `.github` CI directory was found in this checkout.

## Repository map

| Path | Responsibility / useful entry points |
| --- | --- |
| `src/app/` | App Router pages, layouts, and API route handlers |
| `src/components/` | Feature UI, mostly paired with domain helpers in `src/lib/` |
| `src/lib/` | Business rules, DB access, file readers, snapshots, ratings, permissions |
| `src/hooks/` | Auto refresh, live subscriptions, paging, viewport fitting |
| `prisma/schema.prisma` | Main schema; migrations also exist, but deploy uses `db push` |
| `scripts/` | Deployment, collectors, canon/RP builds, audits, repairs, backup, QA |
| `recruit-bot/` | Separate Python Telegram recruitment service; writes platform PostgreSQL directly |
| `data/` | Tracked layout/replay configuration plus mostly ignored runtime datasets and caches |
| `public/` | Static UI assets; large replay minimaps are excluded from Git |
| `storage/` | Runtime uploaded avatars/logos; mostly excluded from Git |
| `e2e/`, `scripts/qa/`, `qa/` | Playwright smoke/auth tests and report generation |
| `deploy/`, `ecosystem.config.cjs` | Nginx examples and PM2 process configuration |

Main UI entry points: `src/app/page.tsx` -> `HomeHub` / `HomePanels`;
`src/app/layout.tsx` -> providers, auth bar, navigation, footer;
`src/app/profile/page.tsx` -> stored profile snapshot + `ProfilePageClient`.
Other useful routes: `/players/[nick]`, `/public`, `/rating`, `/tm`, `/cw`,
`/clans`, `/factions/[slug]`, `/tournaments`, `/battle-pass`, `/replays`, `/admin`.
Global styling is in `globals.css` and `profile-v2.css`, with some feature CSS files.
The viewport now uses device width. Mobile layouts through 1023px use normal
document flow in `src/app/mobile.css`; desktop uses the existing canvas fitting.
See `docs/MOBILE_UI.md` for implementation details and validation limits.

## Mobile UI implementation (2026-11-08)

User constraint: keep demo data/setup in separate files and minimize changes to
existing non-UI code. Production auth, API handlers, Prisma schema, rating logic,
and dependencies were not changed for this work.

- `src/app/mobile.css` is imported after legacy global/profile CSS and defines the
  mobile breakpoint at 1023px. `src/lib/mobileLayout.ts` shares it with fitting and
  interaction code. Root and preview viewports use device width.
- `HomeFit` stops mutating viewport metadata and skips desktop fitting on mobile.
  Home tiles reflow into two/three columns. Profile/BP canvases use unscaled normal
  flow; desktop sizing resumes after resizing above the breakpoint.
- `SiteNav` has a mobile disclosure with nested links, search, outside-click and
  Escape closing, and route closing. `AuthBar`/dropdown hover is disabled in narrow
  layouts to avoid conflicting with clicks. PlayerSearch uses unique input IDs
  because desktop header and mobile menu both include it.
- Profile cards stack; attendance dates expose readable details on tap. Faction
  panes ignore desktop placement; clans, tournaments/bets, ratings, admin forms,
  replay transport, map controls, support, and dialogs have responsive styles.
  Wide tables scroll inside their own region, not by moving the entire page.
- `KvAutoHeightFrame` injects `public/mobile-kv.css` and adapts dynamic iframe
  tables. Training kit pages now use this wrapper too, preserving desktop
  viewport-height sizing. Full external KV UI is not present locally.
- ProfilePageClient now restores sessionStorage state after hydration, avoiding
  the existing SSR mismatch on repeat full-page loads. Data contracts are unchanged.

`preview/mobile/` is an isolated Next app: `node preview/mobile/run.mjs` launches
127.0.0.1:3100. It imports real components/CSS, with its own seeded session,
synthetic populated/empty data, read-only API fixtures and local controls. No DB,
Steam key, production middleware/server layout/API handlers, or request proxy.
Unknown reads return 501 and unsupported writes 405; reaction heartbeat is a
non-persistent acknowledgement. Do not replace production data access with mocks.

Preview now includes home/profile/public rating; clan list/detail/create; faction;
season 2 BP; tournament hub/bracket/bets; aim/register; CW search; clan/FIT/sapper
ratings; admin/users/server panel; CW/TRAIN/kit iframe fixtures; replay viewer;
and the real map shell. Unsupported deep screens remain explicit placeholders.

Validation performed with installed Chrome on 2026-11-08:

- `node preview/mobile/check.mjs`: desktop + iPhone populated/empty states, no
  runtime errors, missing initial API fixtures or unexpected external requests,
  and read-only API behavior.
- `node preview/mobile/responsive-check.mjs`: 46 route/viewport combinations
  across 320/390/768/844/1440px; additional 11 checks cover admin tabs, user editing,
  map shell and training kit page at 390px. A final 390px pass also verifies menu
  navigation/search/Escape, attendance form/details, customization/support dialog
  bounds, and portrait/landscape/desktop resizing.
- Focused ESLint on changed UI files: no errors; two pre-existing unused-helper
  warnings in TrainingSessionsCard. Type check still reports existing errors in
  imported production modules, with no errors in the new preview/mobile code.
- Production build checked in an isolated /tmp copy without credentials. An
  initial build in the working tree failed on a missing generated webpack chunk;
  the isolated build succeeds and avoids sharing .next with any running dev app.

Screenshots are ignored under `preview/mobile/screenshots/`. The KV document and
replay map are clearly marked layout fixtures. Map shell/error fallback checks do
not validate live WebGL geography/CDN assets. DB workflows, real production KV
CSS/JS, rare nested details, Safari/iOS and Android keyboards still need a staging
or real-device pass. See `docs/MOBILE_UI.md`; do not equate smoke coverage with
verification of every backend state. No deployment was performed.

## Identity and authorization

- `src/lib/auth.ts`: Steam login upserts a user; JWT callbacks reload account data
  from PostgreSQL. Session fields are extended in `src/types/next-auth.d.ts`.
- `src/middleware.ts`: allows selected guest pages and redirects unauthenticated or
  incomplete profiles. API requests pass through, so authorization belongs in each handler.
- Platform roles: USER, ADMIN, HR, DEPUTY, SUPER_ADMIN. Clan roles and faction seats
  are separate concepts. Use `roles.ts`, `admin.ts`, `requireAdmin.ts`, and feature
  permissions (`clanAccess.ts`, `tournamentTeamPerms.ts`, `factions.ts`).
- Built-in super-admin/deputy Steam IDs and optional environment additions override
  stored roles. HR currently has platform-level capabilities; the early vision's
  proposed clan-scoped HR matrix does not describe all current behavior.
- SteamID64 is the durable account identity; EOS mappings and nick aliases bridge
  game logs and site accounts. Use `nickIdentity.ts`, `nickCollisions.ts`, and related
  helpers rather than introducing another normalization rule.
- Ingest routes authenticate separately with `SQUAD_INGEST_SECRET` (Bearer or
  `x-squad-ingest-secret` in the sessions handler).

## Data flow and persistence

This is a hybrid PostgreSQL + filesystem application. A fresh clone does not
contain the production statistics or uploaded assets. Database access alone is
insufficient to reproduce all screens.

1. `scripts/squad_log_collector.py` and related tooling ingest Squad logs into
   `/api/ingest/*` (sessions, hits, roles, public matches); Python processing also
   writes DB records and JSON projections.
2. PostgreSQL stores accounts, clans/factions, sessions, hits/roles, public matches,
   canon matches/players, slim RP tables, profile history records, tournaments,
   absence/reserve records, support, mail, notices, visits, and audit events.
3. TRAIN/CW JSON is read through `kvLocal.ts`: `KV_LOCAL_DIR` first, then
   `data/kv-cache`. Callers use paths such as `data/training/YYYY-MM.json`.
   Remote fallback is off unless `KV_ALLOW_REMOTE=1`.
4. `canonMatchRead.ts` overlays DB canon on selected month/player JSON. Defaults:
   `BB_CANON_READ=1`, `BB_VERIFIER_GATE=0`. Disk calendar lifecycle and some player
   files have special precedence; inspect merge rules before changing data sources.
5. `CanonMatch` kinds are TRAIN/CW/PUBLIC; sources LOG/SCREENSHOT/IMPORT_JSON.
   `matchKey` follows `{YYYY-MM-DD}_{serverKey}_{mapStem}_{HHMM}`; legacy IDs are
   additionally scoped by kind/year/month. Do not identify a match by legacy ID alone.
6. Training slim RP uses PostgreSQL first (`trainRp.ts`, `rpDbRead.ts`), falling
   back to KV JSON. Public slim RP deliberately prefers `data/public/rp-ladder.json`
   before DB fallback (`publicRp.ts`); public UI also overlays DB rating numbers.
   Full event ledgers remain on disk for drilldowns. Do not describe all RP as DB-first.
7. Profile first render reads `data/cache/profiles/lines/*.json`; expensive builds
   run through `profileViewSnapshot.ts` and `scripts/warm-profile-views.*`.
   Public ratings use `publicRatingPageCache.ts` and a warmer. Preserve these paths
   when addressing performance; avoid heavy full-ledger work in requests.
8. Public attendance is published at hourly Moscow boundaries using
   `attendancePublish.ts` / `publish_attendance_hourly.sh`; admin attendance can
   read live PostgreSQL. Training server keys include TR1–TR5.

Key runtime flags include `BB_RP_DB_READ`, `BB_RP_DB_WRITE`, `BB_CANON_READ`,
`BB_VERIFIER_GATE`, `KV_LOCAL_DIR`, and `KV_ALLOW_REMOTE`. Inspect individual
readers/writers for exact scope and defaults.

`liveBus.ts` is an in-memory event bus exposed by `/api/live/*` SSE routes;
clients also have polling/refresh helpers. With four PM2 workers, cross-worker
delivery is an architectural limitation to investigate if live updates are missed.

`prisma.ts` pins a global client and adds pool defaults: four connections/process,
two-second pool timeout; the profile warmer uses one connection. Do not remove
these limits without considering all workers and background processes.

## Local work and validation

Use a dedicated development PostgreSQL database and locally configured `.env`.
Required core variables: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
`STEAM_API_KEY`. Example files still mention Neon; that is not the current
documented production host. Runtime datasets may need a separate sanitized copy.

| Command | Meaning / caveat |
| --- | --- |
| `npm ci` | Install locked dependencies; postinstall generates Prisma client |
| `npm run dev` | Start Next development server |
| `npm run db:push` | Apply schema to the configured DB; verify target first |
| `npm run lint` | ESLint; current baseline not measured |
| `npx tsc --noEmit` | Separate type check; current baseline not measured |
| `npm run build` | Clears Next cache, generates Prisma, builds Next |
| `npm start` | Start an existing production build |
| `SMOKE_BASE_URL=http://localhost:3000 npx playwright test --project=smoke` | Guest smoke against a separately running local app |
| `npm run test:smoke` | Runs all Playwright projects and Python PNG report generator |

Build success is not type-safety evidence: `next.config.ts` explicitly sets
`typescript.ignoreBuildErrors=true`. No general unit-test script is configured;
Playwright includes a small absence-reason test plus live browser/API smoke.

Playwright defaults to `https://bb-squad.ru`, with no local `webServer` setup.
The auth project uses `qa/auth/storage.json` and creates/deletes day-off/reserve
state; it is not read-only. Use a test account/database and explicit local target.
`npm run test:auth:save` saves login state; the report helper invokes `python`.
Python dependencies are split between `scripts/requirements-squad-collector.txt`
(Paramiko, requests, psycopg2) and `recruit-bot/requirements.txt` (Telegram, psycopg2).

Initial environment: Python 3 is available; `node` and `npm` were not on PATH,
`node_modules` and local `.env` were absent. No build, lint, type check, browser
tests, DB connection, or live infrastructure checks were performed during this review.

Environment update (2026-11-08): user installed/upgraded Node to v26.13.0 and npm
to 11.20.0; root dependencies are installed. Next 15.5.25 and Prisma 5.22 CLIs
run. The isolated preview was browser-tested. Its TypeScript check follows existing
production imports and reports errors in `src/` (e.g. CwBookButton,
ProfileClientHydrate, trainRp duplicate `net`, and RP buffer typing); no errors
were reported in new preview files. No full production build/DB tests were run.

Database-free follow-up (2026-11-08): the production app has no complete offline/demo mode.
`BB_CANON_READ=0` and `BB_RP_DB_READ=0` disable specific readers, not Prisma
globally. A placeholder local PostgreSQL URL can satisfy configuration for a
limited guest preview, but DB-dependent routes still fail or log errors. Even the
home page invokes mail synchronization (errors are caught). Steam sign-in needs
a real DB user upsert. A reliable full UI demo requires fixtures plus explicit
offline adapters/auth behavior. A separate read-only UI preview has now been
implemented and tested as described above, without adding this mode to production.

## Deployment and operational constraints

Repository documentation (`docs/HOSTING.md`) currently describes production as
plaza (`bb-plaza`, `178.72.181.111`), Nginx + PM2 + local PostgreSQL `bb_squad`;
site `https://bb-squad.ru`. These are documented settings, not live-verified state.
PM2 config runs four cluster workers under `/var/www/bb-squad-platform`.
Staging is documented as a separate directory/database and port 3001.

- Follow the Git deployment flow: commit/push code before server deployment.
  `scripts/deploy.sh` handles maintenance, runtime-data preservation, dependency
  install, Prisma schema push, build/gates, restarts, warmers, and cron installation.
- Deployment is a broad operation, not just a build. Forced-clean mode hard-resets
  to `origin/main`. Inspect the script before using it.
- `scripts/deploy-staging.sh` has a conditional path that stops production during
  a build; staging is not automatically isolated operationally.
- Preserve `data/public`, `data/kv-cache`, caches, uploads, replay minimaps, and live
  battle-pass progress. Never replace runtime datasets with tracked empty stubs or
  remove legacy files merely because DB canon exists.
- `check_deploy_gate.py`, canon verifiers, RP integrity tools, and roster audits
  provide additional domain checks. Many repair/build scripts write data: inspect
  their arguments and target before running them.
- Replay rendering uses the project's own canvas/registry pipeline; preserve
  matching minimap bounds and Unreal-centimeter coordinates. See `docs/BB-REPLAY.md`.

## Documentation trust and current follow-ups

Read current code first for behavior, `docs/HOSTING.md` and deploy scripts for
operational intent, phase documents for migration history, and
`docs/CHANGELOG.md` / `src/data/site-releases.json` for feature history.

README, VISION, ROADMAP, `.env` examples, parts of DEPLOY/COLLAB describe older
Timeweb/Neon/Vercel phases or label implemented features unstarted. Do not infer
current hosting or missing features from those documents alone. CHANGELOG entries
are not strictly ordered and may reuse version numbers. JOURNAL is append-only.
Referenced external Windows workspace, KV repo, and `.cursor` rules are not part
of this checkout.

Next release step: review the mobile UI locally, then validate the real KV mirror,
real datasets, backend workflows and actual devices on staging before deployment.
A dedicated development DB is still required for backend mutation tests.

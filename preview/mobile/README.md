# Local UI preview (no database)

Separate Next application for mobile UI development. Imports the real components,
styles, and static assets from the main repository. It does not import its server
layout, middleware, API handlers, authentication backend, or database connection.
No changes to production logic are needed to add fixtures.

From the repository root:

```bash
npm ci
node preview/mobile/run.mjs
```

Open **http://127.0.0.1:3100**. Use `PREVIEW_PORT=3101` to change the port.
Node 22+ is recommended by this project's working setup; the preview was also
checked with the Node version recorded in `docs/PROJECT_CONTEXT.md`.
No `.env`, Steam key, `DATABASE_URL`, schema push, or second npm installation is needed.
The launcher creates an ignored `public` symlink to the repository's static assets.

Available screens:

- `/`: actual home hub with synthetic CW announcement.
- `/profile`: actual signed-in player profile, synthetic attendance, combat stats,
  match history, roles, hitmap, career, mail, and battle-pass progress.
- `/public`: actual public rating, match history, and guide.
- `/clans`, `/clans/preview-clan`, `/clans/new`: clan list/detail/create.
- `/factions/demo-vanguard`: faction management, roster, and boards.
- `/battle-pass`, `/tournaments`, `/tournaments/bracket`, `/tournaments/bets`.
- `/aim`, `/register`, `/rating`, `/tiers-fit`, `/cw-find`, `/tm/sapper`.
- `/admin` (including query-selected tabs), `/admin/panelka`, `/admin/users/demo`.
- `/cw`, `/tm`, `/tm/rifleman`: embedded KV layout fixtures, not the real KV JS app.
- `/replays/preview`: real viewer with a clearly marked placeholder map.
- `/map`: real map UI, synthetic pins; existing external CDN/WebGL requirements apply.

The floating **LOCAL UI** toolbar switches screens and populated/empty data.
The session is a local test identity, not a Steam login. Changes to component/CSS
source are picked up by Next automatically, so no component copies can drift.
Other routes show an explicit preview placeholder. Deeper drilldowns without a
fixture return HTTP 501; unsupported writes return HTTP 405. No writes persist,
and requests are never proxied to production. UI navigation, tabs, filters,
pagination, and opening dialogs can be exercised; backend workflows cannot.

Fixtures live in `fixtures.ts`; preview API responses in
`app/api/[...path]/route.ts`. Add fixtures when a new screen/interaction is needed.
Preview-specific controls are styled only in `preview.css`; product mobile styles
belong in the main `src/` tree.

With the preview running and Google Chrome installed, run from the repository root:

```bash
node preview/mobile/check.mjs
```

This uses the existing Playwright dependency and installed Chrome (no browser
download). It checks desktop and iPhone emulation, initial screens, empty data,
read-only writes, browser exceptions, missing initial API fixtures, and unexpected
external requests. Screenshots are saved to the ignored `screenshots/` directory.
The stronger mobile layout and interaction suite is:

```bash
node preview/mobile/responsive-check.mjs
```

It covers 320/390/768/844/1440px, checks horizontal page overflow and viewport
stability, and exercises navigation, forms, calendar details, dialogs and resizing.
See [mobile implementation and verification limits](../../docs/MOBILE_UI.md).

An optional type check is `npx tsc --noEmit -p preview/mobile/tsconfig.json`.
It follows imported production components and currently reports existing errors
in those components/libraries; the initial check found no errors in preview files.

Do not deploy this directory as the production application. Normal `npm run dev`
and deployment continue to use the existing application and real authentication.

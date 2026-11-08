# Mobile UI

Implemented locally on 2026-11-08. No deployment or database changes.

## Layout

- The viewport uses device width. `src/app/mobile.css` defines normal document
  flow up to 1023px, loaded after legacy global/profile CSS. `mobileLayout.ts`
  shares that breakpoint with JS measurement and interaction code.
- Home uses two tile columns on phones and three from 600px. The header menu is
  a disclosure with nested navigation, outside-click/Escape closing, and route
  closing. Hover does not fight clicks in the mobile layout.
- Profile is a vertical sequence of cards, with two-column grouping on tablets.
  Full profile/battle-pass canvases are no longer scaled on mobile. Attendance
  days are buttons with readable details below the calendar. Wide history and
  rating tables scroll inside their containers.
- Faction panels ignore desktop placement on mobile. Clan screens, forms,
  tournament panels, bets, admin panels, replay transport, support, and portaled
  dialogs receive width/flow/touch-target rules. Desktop layout remains above
  the breakpoint; training-role iframe sizing has an explicit desktop rule.
- `KvAutoHeightFrame` injects `public/mobile-kv.css` into the same-origin KV
  document and wraps its tables in horizontally scrollable regions on mobile.
  New dynamic tables are observed, wrappers are removed on desktop resize, and
  listeners/timers/observers are cleaned up. Training kit pages use this same
  wrapper, preserving a viewport-height iframe on desktop.
- The profile shell cache is restored in an effect, keeping SSR and the first
  client render identical on reload. API/auth/cache payload formats are unchanged.

## Preview and checks

Use existing root dependencies; no credentials, DB, or schema push:

```bash
node preview/mobile/run.mjs
# http://127.0.0.1:3100
```

With that server running and Google Chrome installed:

```bash
node preview/mobile/check.mjs
node preview/mobile/responsive-check.mjs
```

The first checks populated/empty states on desktop and iPhone emulation. The
second checks page overflow, viewport stability, canvas reflow, selected panel
widths, browser errors, missing fixtures, navigation, calendar details, dialogs,
and resizing. It saves ignored screenshots under `preview/mobile/screenshots/`.
`CHECK_WIDTHS` and `CHECK_ROUTES` allow targeted reruns, for example:

```bash
CHECK_WIDTHS=320 CHECK_ROUTES=/profile,/battle-pass node preview/mobile/responsive-check.mjs
```

Coverage exercised with real components and synthetic data:

| Area | Local coverage |
| --- | --- |
| Shared shell, home, profile, public rating, faction, season 2 BP, tournaments | 320, 390, 768, 844, 1440px; portrait and short landscape |
| Clan list/detail, clan creation, registration, CW search, ratings/FIT, sapper, replay, tournament bracket/bets, aim, admin users/server panel | 390px |
| Admin attendance, journal, visits, reserve, releases, factions, load, mail; user edit; training kit page | Additional 390px route checks, mostly empty administrative datasets |
| Menu, day-off form, calendar details, profile customization, support dialog, resizing | Interaction assertions in the responsive suite |
| Embedded CW/TRAIN tables | Same-origin layout fixture and injected stylesheet/wrapper behavior |
| Community map | Real component shell/error fallback with synthetic pins API; live WebGL geography is not validated offline |

The previews do not copy production components. Fixtures, session, mock API, map
placeholder image, and preview controls live only under `preview/mobile/`.
Unknown API fixtures return 501, unsupported writes return 405; reaction presence
acknowledges a heartbeat without persisting anything. No production request proxy.

## Verification limits

- Full production KV CSS/JS and runtime datasets are absent from this checkout.
  Validate CW/TRAIN/role tabs against the real mirror on staging, including table
  selection, paging, and modals; the local iframe fixture verifies the integration
  mechanism, not every screen of the external KV application.
- The map component still uses its existing CDN geography/texture and requires
  WebGL. Offline/error-shell checks do not establish live globe behavior.
- Database mutations, Steam login, real admin permissions, live RCON, and real
  support/recruitment workflows are outside the read-only preview.
- Rare nested rating details, real replay datasets/minimaps, and every admin
  data-heavy state need a staging pass. Shared layout rules are implemented,
  but do not call those states individually verified from a mock smoke run.
- Chrome emulation does not substitute for Safari/iOS or Android keyboard/device
  testing. Check virtual-keyboard behavior and zoom on actual devices before release.

The modified UI files pass focused ESLint (two existing unused-helper warnings
in TrainingSessionsCard). Type checking still reports existing errors in imported
production modules. Production compilation was also checked in an isolated copy
without credentials so it does not share build output with a running dev server.

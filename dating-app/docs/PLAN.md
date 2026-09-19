# Maktub — build plan

## Context

`docs/spec/` holds the product spec pack (currently `README.md`, `01-product-overview.md`,
and `02-api-contract.md`; the pack's index references `03`–`09` — **those files are not in
the repo yet**; add them to `docs/spec/` as they become available and update the milestones
below with their detail).

The spec targets a SwiftUI iOS client against a real backend (auth, profiles, discovery,
matching, chat; REST + WebSocket). What exists today is the **HTML prototype**
(`index.html`): a single-file, mock-data implementation of the same core loop —
discover → swipe → match → chat. Strategy:

1. The prototype is the living, testable reference for product behavior. Every feature it
   implements is locked by a regression suite in `tests/` so new features can't silently
   break old ones.
1. The API contract (`02`) is implemented as an **in-page mock backend** inside
   `index.html` — every route, the error envelope, rotating tokens, idempotent swipes,
   cursor pagination, and the WS frame set — because the published artifact sandbox blocks
   real network calls. The UI talks to it only through `apiCall()` and the socket frames,
   so swapping in the real backend is a transport change, and `tests/test-api.js` checks
   the contract directly.
2. Spec-driven features land in the prototype first (cheap to validate), each with its own
   test script added to `tests/run-all.js`.
3. When the real client/backend gets built, the specs in `docs/spec/` are the source of
   truth and this prototype + suite serve as the executable description of intended flows.

## Repo layout

```
dating-app/
├── index.html          # the client (single file; mock or remote transport)
├── README.md           # how to run the app, the server, and the tests
├── docs/
│   ├── PLAN.md         # this file — feature plan and status
│   └── spec/           # product spec pack (01–02 present; 03–09 pending)
├── server/             # reference Go backend: real HTTP + WebSocket per 02
├── ios/                # native Swift client: MaktubKit + SwiftUI (CI-verified on macOS)
└── tests/              # per-feature regression suites (Playwright + Chromium)
    ├── package.json    # npm install && npm test
    ├── harness.js      # shared launch/signup/swipe helpers + suite runner
    ├── run-all.js      # runs every suite; run before merging anything
    └── test-*.js       # one script per feature (see table)
```

Rules that keep it usable:

- **One feature, one test script.** A new feature ships with `tests/test-<feature>.js`
  registered in `run-all.js`. A change is mergeable only when `npm test` (in `tests/`) is
  fully green.
- The app stays dependency-free and single-file until the spec's client build starts;
  tests are the only place with npm dependencies (`tests/node_modules/` is gitignored).
- Prototype-only divergences from the spec (on-screen OTP codes instead of SMS, a sample
  photo library instead of camera-roll uploads) are listed per feature below, so nobody
  mistakes them for product decisions.

## Features → tests → status

| # | Feature (spec 01) | Prototype status | Test script | Prototype divergence from spec |
|---|-------------------|------------------|-------------|-------------------------------|
| 1 | Phone OTP signup/login, token refresh, session persistence | Done | `test-auth.js`, `test-api.js` | OTP code is shown on screen (no SMS); access-token TTL simulated with rotating refresh |
| 2 | Profile (name, age, bio, interests, 1–6 photos with reorder + moderation) | Done | `test-profile.js`, `test-photos.js` | Photos come from a mock sample library (real uploads need a backend); moderation is simulated (~2.5s, "Low light" always rejected) |
| 3 | Preferences (age range, distance, genders shown) | Done | `test-filters.js` | Interests filter kept as a documented extension of `PUT /me/preferences` |
| 4 | Discovery deck (gesture + button swipes, rounded km, empty state) | Done | `test-discovery.js` | Mock candidate pool, no geo backend |
| 5 | Match on mutual like (modal → chat) | Done | `test-matching.js` | Mutual likes pre-flagged in mock data |
| 6 | Matches list + 1:1 chat (previews, unread, read receipts, unmatch) | Done | `test-chat.js`, `test-matching.js` | WS is emulated in-page (frames per contract, always "connected"); bot partners auto-reply |
| 6b | API contract (02) end to end | Done | `test-api.js` | In-page mock backend; `banned` and rate-limit interstitials not simulated |
| 6c | Reference Go backend + remote client transport | Done | `test-server.js` | In-memory store (no Postgres/Redis/S3); single-node; OTP logged, not sent |
| 7 | Safety: report + block from every surface, moderation notice | Done | `test-safety.js` | Reports stored locally; no real moderation backend |
| 8 | Settings: legal links, data export, account deletion, notification toggle | Done | `test-settings.js` | Placeholder legal copy; export shows JSON in-app (sandbox blocks downloads); notifications are a stored toggle only |
| 6d | Native Swift client (Kit + SwiftUI core loop) | Done | Swift `MaktubKitTests` via `ios.yml` CI | Runs on macOS CI (no Xcode here); native photos/settings UI still to come |
| 9 | Push notifications (match, message) | Out of prototype scope | — | Browser prototype; revisit in client build |

Spec **v1 non-goals** (no UI, no stubs, no tests): monetization, voice/video/image chat,
undo/rewind, "who liked you", verification badges, ML feed controls, Android/iPad layouts.

## Milestones

- **M1 — Test foundation (this change).** Spec pack landed in `docs/spec/`, repo
  reorganized, features 1–6 locked by suites, `run-all.js` green.
- **M2 — Safety (spec P0). ✅ Done.** Report (reason picker + "reviewed within 24 hours"
  confirmation + optional block) and block reachable from deck card, match row, and chat
  header; blocked users vanish from deck, matches, and unread badges immediately and
  persistently. Shipped with `test-safety.js` (11 tests).
- **M3 — Settings & compliance (spec P0). ✅ Done.** Settings screen off the Profile tab:
  discovery-preferences shortcut, notification toggle (persisted), ToS + privacy policy
  (also linked at signup), support contact, data export (full account as JSON),
  logout, and in-app account deletion behind an explicit confirmation, distinct from
  logout. Shipped with `test-settings.js` (10 tests).
- **M4 — Profile photos. ✅ Done.** 6-slot photo grid on the Profile tab with a sample-photo
  picker, arrow reorder (first photo leads the card), and simulated moderation: new photos
  are owner-visible as "In review", then approved or rejected ("Low light" always rejects,
  deterministically, so the state is demonstrable); a rejection dots the Profile tab until
  removed; pending review resumes across reloads. Candidate cards render only approved
  photos and fall back to initials otherwise. Shipped with `test-photos.js` (10 tests).
- **M5 — API contract. ✅ Done.** `02-api-contract.md` implemented as the in-page mock
  backend; the UI rebuilt onto it: phone OTP onboarding (E.164 validation, `otp_throttled`
  resend cooldown, `invalid_otp` handling), birthdate with the server-enforced `underage`
  hard stop, contract-named models (`onboarding_state`, `distance_km`, `moderation_status`),
  gender preferences, presign→PUT→confirm photo flow, idempotent swipes, unmatch
  (`DELETE /matches/{id}` + `match.closed`), read receipts (`message.read`), and
  `POST /me/export` / `DELETE /me`. Conformance locked by `test-api.js` (13 tests).
  Known gaps for later: `banned` wall, deck rate-limit interstitial, WS reconnect states.
- **M6 — Real backend + real client transport. ✅ Done.** The spec's SwiftUI client can't be
  built or verified in this environment (no Xcode), and the spec pack allows swapping the
  stack — so M6 delivers the other half for real: `server/` is a reference Go backend
  implementing `02` over actual HTTP + WebSocket (gorilla/websocket) with an in-memory
  store, the bot pool, moderation timers, OTP throttling, rotating tokens, idempotent
  swipes, pagination, presigned uploads, and `match.closed` fan-out. The client gained a
  transport layer: served by the Go server it detects `/v1/healthz` and speaks real
  `fetch` + WebSocket (with reconnect backoff and REST message fallback); on `file://` or
  in the artifact sandbox it falls back to the in-page mock. `test-server.js` (13 tests)
  runs HTTP conformance against the real server and drives the served client end to end
  over the real socket. Run it yourself: `cd server && go run .` → http://localhost:8787.
- **M7 — Native Swift client. ✅ Done (core loop).** `ios/` is a Swift package:
  `MaktubKit` (contract models, REST client with rotating-token refresh-and-replay,
  WebSocket client with backoff) and `MaktubUI` (SwiftUI: OTP onboarding with the
  server-enforced 18+ stop, swipe deck + match overlay, matches, chat with typing and
  read receipts, report/block/unmatch, profile edit, logout/deletion), plus a runnable
  macOS entry point (`swift run MaktubApp`). Verified where Swift actually runs:
  `.github/workflows/ios.yml` (macos-14) boots the Go server, passes `swift test`
  (offline decoding + live contract conformance + a real-WebSocket round trip) and
  builds the whole package — green on the first run. Remaining native scope for later:
  photos UI, settings/legal screens, push notifications, and an Xcode iOS app target
  per `09-ui-build-plan.md` when the flow specs land.

## Non-negotiables tracker (spec 01 §Non-negotiables)

| P0 item | Where it stands |
|---------|-----------------|
| 18+ hard stop at signup | Done — guarded by `test-auth.js` |
| Report/block from every user-content surface | Done — guarded by `test-safety.js` |
| Moderation commitment on report confirmation | Done — guarded by `test-safety.js` |
| Real in-app account deletion | Done — guarded by `test-settings.js` |
| Privacy policy + ToS at signup and in settings | Done — guarded by `test-settings.js` |
| Never render precise location (rounded km only) | Done — guarded by `test-discovery.js` |
| Photos render only when approved | Done — guarded by `test-photos.js` |

## How to verify any change

```sh
cd dating-app/tests
npm install          # first time only
npm test             # runs run-all.js — must end with all suites passed
```

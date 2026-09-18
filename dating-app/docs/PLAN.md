# Maktub — build plan

## Context

`docs/spec/` holds the product spec pack (currently `README.md` + `01-product-overview.md`;
the pack's index references `02`–`09` — **those files are not in the repo yet**; add them to
`docs/spec/` as they become available and update the milestones below with their detail).

The spec targets a SwiftUI iOS client against a real backend (auth, profiles, discovery,
matching, chat; REST + WebSocket). What exists today is the **HTML prototype**
(`index.html`): a single-file, mock-data implementation of the same core loop —
discover → swipe → match → chat. Strategy:

1. The prototype is the living, testable reference for product behavior. Every feature it
   implements is locked by a regression suite in `tests/` so new features can't silently
   break old ones.
2. Spec-driven features land in the prototype first (cheap to validate), each with its own
   test script added to `tests/run-all.js`.
3. When the real client/backend gets built, the specs in `docs/spec/` are the source of
   truth and this prototype + suite serve as the executable description of intended flows.

## Repo layout

```
dating-app/
├── index.html          # the app (single file: markup + styles + logic, mock data)
├── README.md           # how to run the app and the tests
├── docs/
│   ├── PLAN.md         # this file — feature plan and status
│   └── spec/           # product spec pack (01 present; 02–09 pending)
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
- Prototype-only divergences from the spec (mock email auth instead of OTP, gradient
  avatars instead of photos) are listed per feature below, so nobody mistakes them for
  product decisions.

## Features → tests → status

| # | Feature (spec 01) | Prototype status | Test script | Prototype divergence from spec |
|---|-------------------|------------------|-------------|-------------------------------|
| 1 | Signup/login + session persistence | Done | `test-auth.js` | Mock email+password instead of phone OTP; no token refresh |
| 2 | Profile (name, age, bio, interests) | Done | `test-profile.js` | Gradient avatar instead of 1–6 photos; no photo moderation states |
| 3 | Preferences (age range, distance, interests) | Done | `test-filters.js` | Interests filter is an extra; spec has genders-shown instead |
| 4 | Discovery deck (gesture + button swipes, rounded km, empty state) | Done | `test-discovery.js` | Mock candidate pool, no geo backend |
| 5 | Match on mutual like (modal → chat) | Done | `test-matching.js` | Mutual likes pre-flagged in mock data |
| 6 | Matches list + 1:1 chat (previews, unread, receipts) | Done | `test-chat.js` | Canned auto-replies instead of WebSocket; no read receipts yet |
| 7 | Safety: report + block from every surface, moderation notice | **Not built** | `test-safety.js` (to add) | — |
| 8 | Settings: legal links, data export, account deletion, notification toggle | **Not built** (only logout + profile edit) | `test-settings.js` (to add) | — |
| 9 | Push notifications (match, message) | Out of prototype scope | — | Browser prototype; revisit in client build |

Spec **v1 non-goals** (no UI, no stubs, no tests): monetization, voice/video/image chat,
undo/rewind, "who liked you", verification badges, ML feed controls, Android/iPad layouts.

## Milestones

- **M1 — Test foundation (this change).** Spec pack landed in `docs/spec/`, repo
  reorganized, features 1–6 locked by suites, `run-all.js` green.
- **M2 — Safety (spec P0).** Report (reason picker + "reviewed within 24 hours"
  confirmation) and block reachable from deck card, match row, and chat; blocked users
  vanish from deck/matches both directions. Ship with `test-safety.js`.
- **M3 — Settings & compliance (spec P0).** Settings screen: privacy policy + ToS links,
  support contact, data export request, notification toggle, in-app account deletion
  (deletes local state, distinct from logout). Ship with `test-settings.js`.
- **M4 — Profile photos.** 1–6 photo slots with reorder and owner-visible
  pending/rejected moderation states (simulated moderation in the prototype). Extend
  `test-profile.js`.
- **M5 — Spec alignment pass.** When `02-api-contract.md` and `03-data-models.md` arrive:
  rename prototype state/fields to the contract's names (`onboarding_state`,
  `distance_km`, …) so the prototype and future client speak the same language. Full
  suite must stay green — that's what it's for.
- **M6 — Real client.** Start the SwiftUI (or chosen stack) build per `09-ui-build-plan.md`,
  porting one prototype feature + its test intent per milestone.

## Non-negotiables tracker (spec 01 §Non-negotiables)

| P0 item | Where it stands |
|---------|-----------------|
| 18+ hard stop at signup | Done — guarded by `test-auth.js` |
| Report/block from every user-content surface | M2 |
| Moderation commitment on report confirmation | M2 |
| Real in-app account deletion | M3 |
| Privacy policy + ToS at signup and in settings | M3 |
| Never render precise location (rounded km only) | Done — guarded by `test-discovery.js` |
| Photos render only when approved | M4 |

## How to verify any change

```sh
cd dating-app/tests
npm install          # first time only
npm test             # runs run-all.js — must end "All 6 suites passed"
```

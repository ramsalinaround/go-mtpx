# Maktub — dating app UI prototype

A single-file, dependency-free dating app prototype: open `index.html` in any
browser (best viewed at phone width, or in a desktop window where it renders
inside a phone-style frame).

It covers the full V1 flow with mock data only — nothing leaves your browser:

- **Auth (phone OTP)** — E.164 phone number, a 6-digit code (shown on screen —
  the prototype has no SMS; it's always `123456`), then profile setup with
  birthdate (18+ enforced server-side), gender, "show me", bio, interests, and
  profile color. Sessions persist with rotating tokens.
- **Discover** — a swipeable card deck (drag, or use the like/pass buttons).
  Some profiles already "like you", so liking them triggers the
  *It's a match!* overlay.
- **Filters** — age range, distance, genders shown, and shared-interest
  filters that rebuild the feed.
- **Matches** — new matches strip plus a message list with previews and unread
  dots. Two conversations come pre-seeded.
- **Chat** — per-match messaging over emulated WebSocket frames, with typing
  indicator, auto-replies, read receipts, and unmatch. The whole app talks to
  an in-page mock backend implementing `docs/spec/02-api-contract.md`.
- **Profile** — edit your bio, interests, and profile color; log out to reset.
- **Photos** — up to 6 sample photos with arrow reorder; new photos sit "In
  review" (simulated moderation) and others only ever see approved ones. A
  rejected photo dots the Profile tab until you remove it.
- **Safety** — report (with reason picker and moderation notice) or block any
  profile from its deck card, match row, or chat header; blocking is immediate,
  both directions, and permanent.
- **Settings** — notification toggle, Terms of Service and Privacy Policy
  (also linked at signup), support contact, full data export as JSON, logout,
  and permanent in-app account deletion behind a confirmation.

State persists to `localStorage` when available, and the prototype degrades
gracefully without it. This directory is unrelated to the Go MTP library in
the rest of the repository.

## Repo layout

| Path | What it is |
|------|------------|
| `index.html` | The client — single file, no build step; picks its transport at boot |
| `server/` | Reference Go backend implementing the API contract (real HTTP + WebSocket) |
| `docs/PLAN.md` | Feature plan, milestones, spec→test→status mapping |
| `docs/spec/` | Product spec pack (`01-product-overview.md`; `02`–`09` pending) |
| `tests/` | Per-feature regression suites (Playwright + Chromium) |

## Running against the real backend

The client normally runs standalone on its in-page mock backend. To run the
same client against the reference Go server (real HTTP + WebSocket per
`docs/spec/02-api-contract.md`):

```sh
cd server
go run .          # serves the client + API on http://localhost:8787
```

Open http://localhost:8787 — the client probes `/v1/healthz` at boot and
switches to the remote transport (check `document.documentElement.dataset.transport`).
The OTP code is logged by the server and is always `123456`. The store is
in-memory: restarting the server resets accounts.

## Testing

Every shipped feature has its own regression script in `tests/` so adding a
feature can't silently break an existing one:

| Script | Feature it guards |
|--------|-------------------|
| `test-api.js` | Contract conformance: error envelope, OTP throttle, token rotation, `underage`, idempotent swipes, pagination, unmatch, deletion |
| `test-auth.js` | OTP signup/login, resend cooldown, 18+ hard stop, session persistence, logout |
| `test-profile.js` | Profile display, edits, persistence, minimum-interests rule |
| `test-discovery.js` | Deck rendering, gesture + button swipes, verdict recording, empty state |
| `test-filters.js` | Age/distance/gender/interest filtering, empty result, reset |
| `test-matching.js` | Match overlay on mutual like, both overlay actions, matches strip, unmatch |
| `test-chat.js` | Conversation list, unread badges, sending, auto-reply, read receipts, persistence |
| `test-safety.js` | Report (reason picker, 24h moderation notice) and block from deck, match row, and chat |
| `test-settings.js` | Settings screen, legal docs (settings + signup), notification toggle, data export, account deletion |
| `test-photos.js` | Photo grid (add/reorder/remove/cap), simulated moderation states, rejection badge, approved-only rendering on cards |
| `test-server.js` | Reference Go backend: HTTP conformance + the served client end to end over a real WebSocket |

Run them all (must be green before merging any change — see `docs/PLAN.md`):

```sh
cd tests
npm install   # first time only
npm test
```

`test-server.js` needs a Go toolchain (`go build` is invoked automatically).
The harness auto-detects the pre-installed Chromium at `/opt/pw-browsers/chromium`
(Claude Code remote environments); elsewhere it uses Playwright's own browser
(`npx playwright install chromium` once), or set `MAKTUB_CHROMIUM=/path/to/chrome`.

**When adding a feature:** implement it in `index.html`, add
`tests/test-<feature>.js` using `tests/harness.js`, register it in
`tests/run-all.js`, and update the tables in `docs/PLAN.md`.

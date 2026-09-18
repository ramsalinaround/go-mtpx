# Maktub — dating app UI prototype

A single-file, dependency-free dating app prototype: open `index.html` in any
browser (best viewed at phone width, or in a desktop window where it renders
inside a phone-style frame).

It covers the full V1 flow with mock data only — nothing leaves your browser:

- **Auth (mock)** — sign up (name, age, email, password, preferences) with a
  profile-setup step (bio, interests, profile color), or log in with any
  email/password.
- **Discover** — a swipeable card deck (drag, or use the like/pass buttons).
  Some profiles already "like you", so liking them triggers the
  *It's a match!* overlay.
- **Filters** — age range, distance, and shared-interest filters that rebuild
  the deck.
- **Matches** — new matches strip plus a message list with previews and unread
  dots. Two conversations come pre-seeded.
- **Chat** — per-match messaging with canned auto-replies (and a typing
  indicator) so the prototype feels alive.
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
| `index.html` | The app — single file, no build step |
| `docs/PLAN.md` | Feature plan, milestones, spec→test→status mapping |
| `docs/spec/` | Product spec pack (`01-product-overview.md`; `02`–`09` pending) |
| `tests/` | Per-feature regression suites (Playwright + Chromium) |

## Testing

Every shipped feature has its own regression script in `tests/` so adding a
feature can't silently break an existing one:

| Script | Feature it guards |
|--------|-------------------|
| `test-auth.js` | Signup validation (incl. 18+ hard stop), login, session persistence, logout |
| `test-profile.js` | Profile display, edits, persistence, minimum-interests rule |
| `test-discovery.js` | Deck rendering, gesture + button swipes, verdict recording, empty state |
| `test-filters.js` | Age/distance/interest filtering, empty result, reset |
| `test-matching.js` | Match overlay on mutual like, both overlay actions, matches strip |
| `test-chat.js` | Conversation list, unread badges, sending, auto-reply, persistence |
| `test-safety.js` | Report (reason picker, 24h moderation notice) and block from deck, match row, and chat |
| `test-settings.js` | Settings screen, legal docs (settings + signup), notification toggle, data export, account deletion |
| `test-photos.js` | Photo grid (add/reorder/remove/cap), simulated moderation states, rejection badge, approved-only rendering on cards |

Run them all (must be green before merging any change — see `docs/PLAN.md`):

```sh
cd tests
npm install   # first time only
npm test
```

The harness auto-detects the pre-installed Chromium at `/opt/pw-browsers/chromium`
(Claude Code remote environments); elsewhere it uses Playwright's own browser
(`npx playwright install chromium` once), or set `MAKTUB_CHROMIUM=/path/to/chrome`.

**When adding a feature:** implement it in `index.html`, add
`tests/test-<feature>.js` using `tests/harness.js`, register it in
`tests/run-all.js`, and update the tables in `docs/PLAN.md`.

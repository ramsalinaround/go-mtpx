# 01 — Product overview

## What this app is

A swipe-based dating app: create a profile, see nearby people who fit your preferences, like or pass,
match on mutual likes, chat inside the match. v1 optimizes for one thing — a new user in the launch metro
reaches a real conversation quickly and safely.

## Core loop

Discover (deck) → swipe → match → chat → return tomorrow for a refreshed deck.
Every design decision should shorten the path around this loop.

## v1 scope (in)

- Phone-number OTP signup and login; session persistence with silent token refresh
- Profile: name, birthdate (age shown, never DOB), gender, bio, 1–6 photos with reorder
- Preferences: age range, max distance, genders shown
- Discovery deck: geo + preference filtered candidates, distance shown as rounded km only
- Like / pass via gesture and buttons; match modal on mutual like
- Matches list + 1:1 text chat with read receipts, delivered over WebSocket with push fallback
- Safety: report (reason picker), block (both directions, immediate), banned-account wall
- Settings: edit profile/preferences, notification toggle, privacy policy + ToS links, support contact, data export request, logout, **in-app account deletion**
- Push notifications: new match, new message

## v1 non-goals (out — do not build UI stubs for these)

- Paid tiers, boosts, super-likes, or any monetization surface
- Video/voice chat, voice notes, image messages (text only in chat)
- Undo/rewind swipes, "who liked you" grid, profile verification badges
- ML-ranked feed controls, advanced filters beyond age/distance/gender
- Android, iPad-optimized layouts (iPhone portrait only; must not break on iPad, but no bespoke layout)

## App structure

Three tabs, visible only after onboarding completes:

| Tab | Root screen | Badge |
|-----|-------------|-------|
| Deck | Discovery deck (`06`) | none |
| Matches | Matches + conversations list (`07`) | unread count |
| Profile | Own profile + settings entry (`08`) | dot when a photo was rejected |

Onboarding (`05`) is a separate navigation stack shown when there is no valid session **or** the profile
is incomplete (server tells us via `onboarding_state` — see `03`).

## Non-negotiables (App Review + safety; all P0)

1. 18+ only. Server enforces from birthdate; UI hard-stops underage input with no retry loophole (`05`).
2. Report and block reachable from every place another user's content appears: deck card, match row, chat (`08`).
3. Stated moderation commitment ("reviewed within 24 hours") shown on report confirmation.
4. In-app account deletion that actually deletes (calls `DELETE /v1/me`), not a support mailto (`08`).
5. Privacy policy and ToS reachable from settings and shown at signup.
6. Never render precise location. Only the server-rounded `distance_km` string.
7. Photos render only after `moderation_status = approved`; the owner sees pending/rejected states, other users never see non-approved photos (server guarantees, UI must still handle gaps).

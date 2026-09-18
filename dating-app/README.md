# Kindred — dating app UI prototype

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

State persists to `localStorage` when available, and the prototype degrades
gracefully without it. This directory is unrelated to the Go MTP library in
the rest of the repository.

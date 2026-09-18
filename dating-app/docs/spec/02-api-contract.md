# 02 — API contract (client view)

Source of truth for everything the iOS app sends and receives. Mirrors the backend design
(modular monolith; Postgres/Redis/S3; presigned uploads; idempotent swipes; WS chat).

## Conventions

- Base URL: `https://api.{domain}/v1` (injected per environment: dev / staging / prod)
- Auth: `Authorization: Bearer <access_token>` on every call except OTP + refresh
- Access token TTL ~15 min. On `401 token_expired`, call refresh once, replay the request; refresh failure → wipe session → onboarding stack
- Content type: `application/json` both ways, except the presigned photo PUT (binary to S3)
- Timestamps: ISO-8601 UTC strings; render in local time
- Pagination: cursor style — `?limit=&before=<cursor>`; response includes `next_cursor` or null

### Error envelope (every non-2xx)

```json
{ "error": { "code": "rate_limited", "message": "Human-readable detail", "retry_after_s": 30 } }
```

Codes the UI must branch on: `token_expired`, `invalid_otp`, `otp_throttled`, `underage`,
`rate_limited`, `blocked`, `match_closed`, `photo_rejected`, `banned`, `validation_failed`, `not_found`.
`banned` on any call → show banned wall (`08`). Anything unrecognized → generic error state + retry.

## Auth + session

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /otp/request` | `{ "phone": "+13035551234" }` | `204` | E.164. `otp_throttled` carries `retry_after_s` → drive resend cooldown |
| `POST /otp/verify` | `{ "phone", "code" }` | `{ access_token, refresh_token, user: User }` | `user.onboarding_state` routes next screen |
| `POST /auth/refresh` | `{ "refresh_token" }` | new token pair | Rotating: store the new refresh token |
| `POST /auth/logout` | `{ "refresh_token" }` | `204` | Also delete device record client-side state |
| `POST /devices` | `{ "push_token", "platform": "ios" }` | `204` | Call after APNs grant and on token rotation |

## Profile, preferences, photos

| Method + path | Body / params | Returns |
|---|---|---|
| `GET /me` | — | `User` (incl. profile, preferences, photos, onboarding_state) |
| `PATCH /me/profile` | any of `{ name, birthdate, gender, bio }` | updated `Profile`; `underage` error on DOB < 18y |
| `PUT /me/preferences` | `{ min_age, max_age, max_distance_km, genders }` | `Preferences` |
| `PUT /me/location` | `{ lat, lon }` | `204` — send on foreground + significant change; never displayed |
| `POST /me/photos/presign` | `{ "content_type": "image/jpeg" }` | `{ upload_url, key }` |
| — client `PUT upload_url` | JPEG bytes ≤ 10 MB | S3 `200` |
| `POST /me/photos/confirm` | `{ "key" }` | `Photo` with `moderation_status: "pending"` |
| `PATCH /me/photos/order` | `{ "ordered_ids": [] }` | `204` |
| `DELETE /me/photos/{id}` | — | `204` |

Photo URLs in every response are opaque CDN URLs, already sized: `thumb`, `card`, `full`. Never construct URLs.

## Discovery + matching

| Method + path | Body / params | Returns |
|---|---|---|
| `GET /feed?limit=25` | — | `{ candidates: [Candidate], next_cursor }` — pre-filtered, excludes swiped/blocked/matched |
| `POST /swipes` | `{ "target_id", "direction": "like"\|"pass", "client_id": uuid }` | `{ "match": Match \| null }` |

Swipes are idempotent on (`user`,`target`): safe to retry with the same body after network failure.
`match != null` → present match modal immediately (`06`). `rate_limited` → deck interstitial, not an alert.

## Matches + chat (REST)

| Method + path | Params | Returns |
|---|---|---|
| `GET /matches` | `?limit=&before=` | `{ matches: [Match], next_cursor }` sorted by last activity |
| `DELETE /matches/{id}` | — | `204` (unmatch; chat closes both sides) |
| `GET /matches/{id}/messages` | `?limit=50&before=` | `{ messages: [Message], next_cursor }` newest-first |
| `POST /matches/{id}/messages` | `{ "body", "client_id": uuid }` | `Message` — REST fallback when WS is down |
| `POST /matches/{id}/read` | `{ "last_message_id" }` | `204` |

## WebSocket

- URL: `wss://api.{domain}/v1/ws?token=<access_token>` — reconnect with fresh token after refresh
- Heartbeat: server `ping` every 30 s; client replies `pong`; two missed → treat as disconnected
- Reconnect: exponential backoff 1 s → 30 s cap, jittered; on reconnect, `GET /matches` + open thread deltas to resync
- Frame shape: `{ "type": "...", "data": { ... }, "client_id"?: uuid }`

| Direction | type | data |
|---|---|---|
| client → | `message.send` | `{ match_id, body, client_id }` |
| client → | `message.read` | `{ match_id, last_message_id }` |
| → client | `message.new` | `Message` (echoes `client_id` for optimistic reconciliation) |
| → client | `message.read` | `{ match_id, last_message_id, reader_id }` |
| → client | `match.new` | `Match` |
| → client | `match.closed` | `{ match_id, reason: "unmatched"\|"blocked"\|"account_deleted" }` |

`match.closed` → close/disable that thread everywhere immediately; never distinguish reasons in copy shown
to the other user beyond "This conversation has ended."

## Safety + account

| Method + path | Body | Returns |
|---|---|---|
| `POST /blocks` | `{ "user_id" }` | `204` — feed, matches, chat with that user all end |
| `POST /reports` | `{ "user_id", "reason": ReportReason, "detail"? }` | `204` |
| `DELETE /me` | — | `204` — soft delete now, purge async; client wipes session |
| `POST /me/export` | — | `202` — export emailed/linked later; UI just confirms request |

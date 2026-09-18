# Dating app — iOS UI spec pack

Markdown context files for building the iOS client UI against the backend defined in this project
(modular monolith: auth, profiles, discovery, matching, chat; Postgres + Redis + S3/CDN; REST + WebSocket).
Drop this folder into the app repo (e.g. `/docs/spec/`) and point your coding agent at it, or use it as
the working reference while building by hand.

## Assumptions

- **Stack:** SwiftUI, iOS 17+, Swift 5.10+, MVVM (view → view model → service layer). Swap freely; the specs describe behavior, not framework internals.
- **Networking:** REST over HTTPS + one WebSocket connection, per `02-api-contract.md`. That file is the source of truth for anything the UI sends or receives.
- **Design:** No brand exists yet. `04-design-system.md` defines neutral tokens as placeholders — reference tokens by name in code so a later brand pass is a one-file change.

## File index

| File | What it covers | Read it when |
|------|----------------|--------------|
| `01-product-overview.md` | Scope, core loop, tab structure, non-negotiables | Starting anything |
| `02-api-contract.md` | REST endpoints, WS protocol, errors, auth | Building the service layer |
| `03-data-models.md` | Client models, enums, state rules | Building models + persistence |
| `04-design-system.md` | Tokens, components, motion, haptics, a11y | Building any view |
| `05-flow-onboarding.md` | Welcome → OTP → profile → photos → prefs → permissions | Onboarding milestone |
| `06-flow-discovery.md` | Deck, swiping, match moment, empty states | Discovery milestone |
| `07-flow-matches-chat.md` | Matches list, chat, WS states, receipts | Chat milestone |
| `08-flow-settings-safety.md` | Profile edit, settings, report/block, deletion, banned wall | Settings + compliance milestone |
| `09-ui-build-plan.md` | Milestone order, per-milestone checklists, store-mandatory items | Planning + tracking |

## Conventions used across the flow files

- Every screen spec has: **Purpose · Layout · States · API · Navigation · Accessibility**. If a state isn't listed, it doesn't exist for that screen.
- States always cover: loading, content, empty, error, offline — plus screen-specific ones (e.g. `moderation_pending`).
- Token names (`color/accent`, `space/4`) come from `04-design-system.md`. Never hardcode values in views.
- "P0" in the build plan means the app does not ship to the store without it (several are literally App Review requirements — see `08` and `09`).

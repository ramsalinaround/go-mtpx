# Maktub — native Swift client (M7)

The native client for the Maktub prototype, as a Swift package:

| Target | What it is |
|--------|------------|
| `MaktubKit` | Pure-Foundation networking layer for `docs/spec/02-api-contract.md`: wire models, REST client with rotating-token refresh-and-replay, WebSocket client (frames, pong, 1s→30s backoff). No UI imports. |
| `MaktubUI` | The SwiftUI client — OTP onboarding (server-enforced 18+ stop), swipe deck, match overlay, matches list, chat with typing/read receipts, report/block/unmatch, profile edit, logout/delete. |
| `MaktubApp` | Executable entry point (`swift run MaktubApp` opens the app on macOS). |
| `MaktubKitTests` | Offline decoding tests plus a live contract-conformance suite mirroring `tests/test-api.js`, gated on `MAKTUB_BASE_URL`. |

## Run it (macOS, Swift 5.9+)

```sh
cd dating-app/server && go run .        # backend on http://127.0.0.1:8787
cd dating-app/ios && swift run MaktubApp
```

The OTP code is always `123456` (the server logs it). The server URL is editable
on the welcome screen.

## Test it

```sh
cd dating-app/server && go run . &      # or any deployed instance
cd dating-app/ios
MAKTUB_BASE_URL=http://127.0.0.1:8787 swift test
```

Without `MAKTUB_BASE_URL` the live-contract tests skip and only the offline
decoding tests run.

## iOS

Open `Package.swift` in Xcode and add an iOS app target that depends on
`MaktubUI` (the package targets iOS 17). All views are plain SwiftUI and run on
both platforms; the macOS executable exists so the client can be built and
exercised without Xcode project files.

## CI

`.github/workflows/ios.yml` runs on a macOS runner: it boots the Go server,
runs `swift test` (decoding + live conformance + a real-WebSocket round trip),
and builds the whole package including the SwiftUI app. This is the check that
keeps the native client honest from Linux-only development environments.

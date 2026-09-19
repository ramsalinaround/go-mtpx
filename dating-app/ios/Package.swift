// swift-tools-version:5.9
import PackageDescription

// Maktub native client (M7).
// - MaktubKit: pure Foundation networking layer for docs/spec/02-api-contract.md
//   (models, REST client with refresh-and-replay, WebSocket frames). No UI imports,
//   so it stays portable and unit-testable.
// - MaktubUI:  the SwiftUI client (core loop: OTP onboarding, deck, matches, chat).
// - MaktubApp: executable entry point; `swift run MaktubApp` on macOS launches the
//   client against a running dating-app/server (default http://127.0.0.1:8787).
//   For iOS, open this package in Xcode and attach an iOS app target to MaktubUI.
let package = Package(
    name: "Maktub",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MaktubKit", targets: ["MaktubKit"]),
        .library(name: "MaktubUI", targets: ["MaktubUI"]),
        .executable(name: "MaktubApp", targets: ["MaktubApp"]),
    ],
    targets: [
        .target(name: "MaktubKit"),
        .target(name: "MaktubUI", dependencies: ["MaktubKit"]),
        .executableTarget(name: "MaktubApp", dependencies: ["MaktubUI"]),
        .testTarget(name: "MaktubKitTests", dependencies: ["MaktubKit"]),
    ]
)

import SwiftUI
import MaktubUI

// Native Maktub client entry point.
// macOS:  cd dating-app/server && go run .        (starts the backend)
//         cd dating-app/ios && swift run MaktubApp
// iOS:    open Package.swift in Xcode, add an iOS app target depending on
//         MaktubUI, and set the server URL on the welcome screen. (iOS apps
//         need an app bundle, so this bare executable is macOS-only; on other
//         platforms it compiles to a no-op so the package scheme still builds.)
#if os(macOS)
@main
struct MaktubApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
#else
@main
struct MaktubAppUnavailable {
    static func main() {
        print("MaktubApp's bare executable is macOS-only; use an Xcode iOS app target with MaktubUI.")
    }
}
#endif

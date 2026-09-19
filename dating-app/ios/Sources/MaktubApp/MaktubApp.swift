import SwiftUI
import MaktubUI

// Native Maktub client entry point.
// macOS:  cd dating-app/server && go run .        (starts the backend)
//         cd dating-app/ios && swift run MaktubApp
// iOS:    open Package.swift in Xcode, add an iOS app target depending on
//         MaktubUI, and set the server URL on the welcome screen.
@main
struct MaktubApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

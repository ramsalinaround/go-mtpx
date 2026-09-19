import SwiftUI
import MaktubKit

public struct RootView: View {
    @StateObject private var model = AppModel()

    public init() {}

    public var body: some View {
        ZStack {
            switch model.route {
            case .welcome:
                WelcomeView(model: model)
            case .phone:
                PhoneView(model: model)
            case .otp:
                OTPView(model: model)
            case .setup:
                SetupView(model: model)
            case .home:
                HomeView(model: model)
            }

            if let match = model.newMatch {
                MatchOverlay(model: model, match: match)
                    .transition(.opacity)
            }

            if let toast = model.toast {
                VStack {
                    Spacer()
                    Text(toast)
                        .font(.footnote.weight(.bold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(.black.opacity(0.8))
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                        .padding(.bottom, 60)
                }
                .allowsHitTesting(false)
            }
        }
        .frame(minWidth: 380, minHeight: 700)
        .task { await model.start() }
        .sheet(isPresented: Binding(
            get: { model.chat != nil },
            set: { if !$0 { model.closeChat() } }
        )) {
            ChatView(model: model)
                .frame(minWidth: 380, minHeight: 560)
        }
    }
}

struct HomeView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        TabView {
            DeckView(model: model)
                .tabItem { Label("Discover", systemImage: "flame") }
            MatchesView(model: model)
                .tabItem {
                    Label("Matches", systemImage: "bubble.left.and.bubble.right")
                }
                .badge(model.unreadCount)
            ProfileView(model: model)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(SceneArt.accent)
    }
}

import SwiftUI
import MaktubKit

struct DeckView: View {
    @ObservedObject var model: AppModel
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                if model.deck.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "heart")
                            .font(.system(size: 42))
                            .foregroundColor(.secondary)
                        Text("You're all caught up")
                            .font(.system(.title3, design: .serif).weight(.semibold))
                        Text("No more people match your filters right now.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                } else {
                    // second card sits underneath
                    if model.deck.count > 1 {
                        CandidateCard(candidate: model.deck[1])
                            .scaleEffect(0.95)
                            .offset(y: 12)
                    }
                    CandidateCard(candidate: model.deck[0])
                        .overlay(alignment: .topLeading) {
                            stamp("LIKE", color: .green)
                                .opacity(Double(max(0, dragOffset.width) / 80))
                                .padding(18)
                        }
                        .overlay(alignment: .topTrailing) {
                            stamp("NOPE", color: SceneArt.accent)
                                .opacity(Double(max(0, -dragOffset.width) / 80))
                                .padding(18)
                        }
                        .offset(x: dragOffset.width, y: dragOffset.height * 0.35)
                        .rotationEffect(.degrees(Double(dragOffset.width) * 0.055))
                        .gesture(
                            DragGesture()
                                .onChanged { value in dragOffset = value.translation }
                                .onEnded { value in
                                    if value.translation.width > 90 {
                                        model.swipeTop(direction: "like")
                                    } else if value.translation.width < -90 {
                                        model.swipeTop(direction: "pass")
                                    }
                                    withAnimation(.spring(duration: 0.25)) { dragOffset = .zero }
                                }
                        )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 28) {
                Button {
                    model.swipeTop(direction: "pass")
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 22, weight: .bold))
                        .frame(width: 58, height: 58)
                }
                .buttonStyle(.bordered)
                .clipShape(Circle())
                .disabled(model.deck.isEmpty)

                Button {
                    model.swipeTop(direction: "like")
                } label: {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 22, weight: .bold))
                        .frame(width: 58, height: 58)
                }
                .buttonStyle(.borderedProminent)
                .tint(SceneArt.accent)
                .clipShape(Circle())
                .disabled(model.deck.isEmpty)
            }
            .padding(.bottom, 8)
        }
        .padding(16)
    }

    private func stamp(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 24, weight: .heavy))
            .foregroundColor(color)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: 3))
            .rotationEffect(.degrees(text == "LIKE" ? -12 : 12))
    }
}

struct CandidateCard: View {
    let candidate: Candidate

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let photo = candidate.photos.first {
                    // only approved photos ever arrive here (server guarantee)
                    Rectangle().fill(SceneArt.gradient(for: photo.urls.card))
                } else {
                    ZStack {
                        Rectangle().fill(SceneArt.hueGradient(index: candidate.hueIndex))
                        Text(String(candidate.name.prefix(1)))
                            .font(.system(size: 110, weight: .semibold, design: .serif))
                            .foregroundColor(.white.opacity(0.5))
                    }
                }
            }
            LinearGradient(colors: [.clear, .black.opacity(0.72)],
                           startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(candidate.name)
                        .font(.system(size: 28, weight: .semibold, design: .serif))
                    Text("\(candidate.age)")
                        .font(.title3)
                        .opacity(0.9)
                }
                Text("\(candidate.distanceKm) km away · \(candidate.job ?? "")")
                    .font(.footnote)
                    .opacity(0.9)
                if let bio = candidate.bio {
                    Text(bio).font(.subheadline).opacity(0.95)
                }
                HStack(spacing: 6) {
                    ForEach(candidate.interests.prefix(3), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(.white.opacity(0.22))
                            .clipShape(Capsule())
                    }
                }
            }
            .foregroundColor(.white)
            .padding(18)
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(radius: 10, y: 6)
    }
}

struct MatchOverlay: View {
    @ObservedObject var model: AppModel
    let match: Match

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: -14) {
                AvatarView(name: model.me?.profile.name ?? "?",
                           hueIndex: model.me?.profile.hueIndex, size: 88)
                AvatarView(name: match.user.name, hueIndex: match.user.hueIndex, size: 88)
            }
            Text("It's a match!")
                .font(.system(size: 40, weight: .semibold, design: .serif))
                .italic()
                .foregroundColor(.white)
            Text("You and \(match.user.name) liked each other.")
                .foregroundColor(.white.opacity(0.9))
            Button {
                model.openChat(match)
            } label: {
                Text("Say hello")
                    .font(.headline)
                    .frame(maxWidth: 260)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundColor(SceneArt.accent)
            Button("Keep swiping") {
                model.newMatch = nil
            }
            .foregroundColor(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(colors: [Color(red: 0.70, green: 0.13, blue: 0.28),
                                    Color(red: 0.36, green: 0.06, blue: 0.19)],
                           startPoint: .top, endPoint: .bottom)
        )
    }
}

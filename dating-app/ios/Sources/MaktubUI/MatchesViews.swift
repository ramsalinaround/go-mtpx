import SwiftUI
import MaktubKit

struct MatchesView: View {
    @ObservedObject var model: AppModel

    private var fresh: [Match] { model.matches.filter { $0.lastMessage == nil } }
    private var talked: [Match] { model.matches.filter { $0.lastMessage != nil } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !fresh.isEmpty {
                    Text("NEW MATCHES")
                        .font(.caption.weight(.bold))
                        .foregroundColor(.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(fresh) { match in
                                Button {
                                    model.openChat(match)
                                } label: {
                                    VStack(spacing: 5) {
                                        AvatarView(name: match.user.name,
                                                   hueIndex: match.user.hueIndex, size: 58)
                                        Text(match.user.name).font(.caption.weight(.bold))
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                Text("MESSAGES")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.secondary)
                if model.matches.isEmpty {
                    VStack(spacing: 6) {
                        Text("No matches yet")
                            .font(.system(.title3, design: .serif).weight(.semibold))
                        Text("Head to Discover — someone out there already likes you.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                } else if talked.isEmpty {
                    Text("Tap a new match above to start the conversation.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.vertical, 24)
                } else {
                    ForEach(talked) { match in
                        Button {
                            model.openChat(match)
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(name: match.user.name, hueIndex: match.user.hueIndex, size: 52)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(match.user.name).font(.headline)
                                    if let last = match.lastMessage {
                                        Text(last.body)
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                if match.unreadCount > 0 {
                                    Circle().fill(SceneArt.accent).frame(width: 10, height: 10)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
            }
            .padding(16)
        }
        .refreshable { await model.refreshMatches() }
    }
}

struct ChatView: View {
    @ObservedObject var model: AppModel
    @State private var draft = ""
    @State private var confirmBlock = false
    @State private var confirmUnmatch = false

    var body: some View {
        if let chat = model.chat {
            VStack(spacing: 0) {
                header(chat)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 8) {
                            Text("Matched with \(chat.match.user.name)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .padding(.top, 10)
                            ForEach(chat.messages) { message in
                                bubble(message, chat: chat)
                            }
                            if chat.partnerTyping {
                                HStack {
                                    Text("\(chat.match.user.name) is typing…")
                                        .font(.footnote)
                                        .italic()
                                        .foregroundColor(.secondary)
                                    Spacer()
                                }
                                .padding(.horizontal, 16)
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.vertical, 6)
                    }
                    .onChange(of: chat.messages.count) {
                        withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                    }
                }
                Divider()
                HStack(spacing: 10) {
                    TextField("Say something kind…", text: $draft)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(send)
                    Button(action: send) {
                        Image(systemName: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(SceneArt.accent)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(12)
            }
            .confirmationDialog("Block \(chat.match.user.name)? You won't see each other anywhere in Maktub.",
                                isPresented: $confirmBlock, titleVisibility: .visible) {
                Button("Block", role: .destructive) { model.block(userId: chat.match.user.id) }
            }
            .confirmationDialog("Unmatch \(chat.match.user.name)? The conversation closes for both of you.",
                                isPresented: $confirmUnmatch, titleVisibility: .visible) {
                Button("Unmatch", role: .destructive) { model.unmatch(matchId: chat.match.id) }
            }
        }
    }

    private func header(_ chat: ChatState) -> some View {
        HStack(spacing: 10) {
            Button {
                model.closeChat()
            } label: {
                Image(systemName: "chevron.left").font(.headline)
            }
            .buttonStyle(.plain)
            AvatarView(name: chat.match.user.name, hueIndex: chat.match.user.hueIndex, size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(chat.match.user.name), \(chat.match.user.age)").font(.headline)
                Text("\(chat.match.user.job ?? "") · \(chat.match.user.distanceKm) km away")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Menu {
                Menu("Report \(chat.match.user.name)") {
                    ForEach(ReportReason.allCases, id: \.rawValue) { reason in
                        Button(reason.label) {
                            model.report(userId: chat.match.user.id, reason: reason)
                        }
                    }
                }
                Button("Unmatch", role: .destructive) { confirmUnmatch = true }
                Button("Block", role: .destructive) { confirmBlock = true }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
        .padding(12)
    }

    private func bubble(_ message: Message, chat: ChatState) -> some View {
        let mine = message.senderId != chat.match.user.id
        return HStack {
            if mine { Spacer(minLength: 60) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                Text(message.body)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(mine ? SceneArt.accent : Color.secondary.opacity(0.15))
                    .foregroundColor(mine ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                if mine, message.seq <= chat.theirLastReadSeq,
                   message.id == lastReadOwnMessageId(chat) {
                    Text("Read").font(.caption2.weight(.bold)).foregroundColor(.secondary)
                }
            }
            if !mine { Spacer(minLength: 60) }
        }
        .padding(.horizontal, 16)
    }

    private func lastReadOwnMessageId(_ chat: ChatState) -> String? {
        chat.messages.last {
            $0.senderId != chat.match.user.id && $0.seq <= chat.theirLastReadSeq
        }?.id
    }

    private func send() {
        let text = draft
        draft = ""
        model.sendChatMessage(text)
    }
}

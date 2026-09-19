import Foundation
import SwiftUI
import MaktubKit

// Client state for the native app. Mirrors the web client's behavior: every
// mutation goes through the API, frames drive chat/matches, and the 18+ stop,
// receipts, and match.closed handling all come from the server.

public let kInterests = ["Hiking", "Coffee", "Film", "Live music", "Cooking", "Climbing",
                         "Books", "Travel", "Yoga", "Photography", "Running", "Board games",
                         "Art", "Dogs", "Wine", "Surfing"]

public struct ChatState: Identifiable {
    public var id: String { match.id }
    public var match: Match
    public var messages: [Message] = []
    public var theirLastReadSeq: Int = 0
    public var partnerTyping = false
}

@MainActor
public final class AppModel: ObservableObject {
    public enum Route {
        case welcome, phone, otp, setup, home
    }

    @Published public var route: Route = .welcome
    @Published public var busy = false
    @Published public var errorMessage: String?
    @Published public var toast: String?

    @Published public var baseURLString: String
    @Published public var phone = ""

    @Published public var me: Me?
    @Published public var deck: [Candidate] = []   // index 0 = top card
    @Published public var matches: [Match] = []
    @Published public var newMatch: Match?
    @Published public var chat: ChatState?

    private var api: APIClient
    private var socket: SocketClient?
    private let defaults = UserDefaults.standard

    public init() {
        let stored = UserDefaults.standard.string(forKey: "maktub.baseURL")
        let base = stored ?? "http://127.0.0.1:8787"
        baseURLString = base
        api = APIClient(baseURL: URL(string: base) ?? URL(string: "http://127.0.0.1:8787")!)
    }

    private func rebuildAPI() {
        let url = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:8787")!
        defaults.set(baseURLString, forKey: "maktub.baseURL")
        api = APIClient(baseURL: url)
    }

    private func persistTokens() async {
        let tokens = await api.currentTokens()
        defaults.set(tokens.access, forKey: "maktub.access")
        defaults.set(tokens.refresh, forKey: "maktub.refresh")
    }

    private func clearPersistedSession() {
        defaults.removeObject(forKey: "maktub.access")
        defaults.removeObject(forKey: "maktub.refresh")
    }

    private func fail(_ error: Error) {
        if let e = error as? MaktubError {
            errorMessage = e.message
        } else {
            errorMessage = "Couldn't reach the server — is dating-app/server running?"
        }
    }

    private func showToast(_ text: String) {
        toast = text
        Task {
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            if self.toast == text { self.toast = nil }
        }
    }

    // MARK: - session restore

    public func start() async {
        rebuildAPI()
        guard let access = defaults.string(forKey: "maktub.access"),
              let refresh = defaults.string(forKey: "maktub.refresh") else { return }
        await api.setTokens(access: access, refresh: refresh)
        do {
            let me = try await api.me()
            self.me = me
            if me.onboardingState == "complete" {
                await enterHome()
            } else {
                route = .setup
            }
        } catch {
            clearPersistedSession()
            await api.setTokens(access: nil, refresh: nil)
        }
    }

    // MARK: - auth flow

    public func beginPhone() {
        rebuildAPI()
        errorMessage = nil
        route = .phone
    }

    public func sendCode() async {
        busy = true
        defer { busy = false }
        errorMessage = nil
        let normalized = phone.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        phone = normalized
        do {
            try await api.requestOTP(phone: normalized)
            showToast("Prototype SMS — your code is 123456")
            route = .otp
        } catch let e as MaktubError where e.code == "otp_throttled" {
            errorMessage = "Too many codes — try again in \(e.retryAfterS ?? 60)s."
        } catch {
            fail(error)
        }
    }

    public func verifyCode(_ code: String) async {
        busy = true
        defer { busy = false }
        errorMessage = nil
        do {
            let resp = try await api.verifyOTP(phone: phone, code: code)
            me = resp.user
            await persistTokens()
            if resp.user.onboardingState == "complete" {
                await enterHome()
                showToast("Welcome back!")
            } else {
                route = .setup
            }
        } catch let e as MaktubError where e.code == "invalid_otp" {
            errorMessage = "That code didn't match — check and try again."
        } catch {
            fail(error)
        }
    }

    public func completeProfile(
        name: String, birthdate: String, gender: String, showMe: String,
        bio: String, interests: [String]
    ) async {
        busy = true
        defer { busy = false }
        errorMessage = nil
        do {
            try await api.patchProfile([
                "name": name, "birthdate": birthdate, "gender": gender,
                "bio": bio.isEmpty ? "Just here to see how the native client feels." : bio,
                "interests": interests,
            ])
            try await api.putPreferences(
                minAge: 21, maxAge: 40, maxDistanceKm: 25,
                genders: showMe == "everyone" ? [] : [showMe])
            try await api.putLocation(lat: 39.7392, lon: -104.9903)
            try? await api.registerDevice(pushToken: "mock-native")
            me = try await api.me()
            await persistTokens()
            await enterHome()
            showToast("Welcome, \(name)!")
        } catch let e as MaktubError where e.code == "underage" {
            errorMessage = "You must be 18 or older to use Maktub."
        } catch {
            fail(error)
        }
    }

    public func logout() async {
        socket?.disconnect()
        socket = nil
        await api.logout()
        clearPersistedSession()
        me = nil
        deck = []
        matches = []
        chat = nil
        newMatch = nil
        route = .welcome
        showToast("Logged out")
    }

    public func deleteAccount() async {
        do {
            try await api.deleteAccount()
            socket?.disconnect()
            socket = nil
            clearPersistedSession()
            me = nil
            deck = []
            matches = []
            chat = nil
            route = .welcome
            showToast("Account deleted")
        } catch {
            fail(error)
        }
    }

    // MARK: - home

    public func enterHome() async {
        do {
            deck = try await api.feed().candidates
            matches = try await api.matches()
            route = .home
            connectSocket()
        } catch {
            fail(error)
        }
    }

    private func connectSocket() {
        socket?.disconnect()
        guard let url = URL(string: baseURLString) else { return }
        let s = SocketClient(baseURL: url)
        socket = s
        Task { [weak self] in
            guard let self else { return }
            let tokens = await self.api.currentTokens()
            guard let access = tokens.access else { return }
            s.connect(token: access)
            for await frame in s.frames {
                self.handle(frame)
            }
        }
    }

    private func handle(_ frame: ServerFrame) {
        switch frame {
        case .messageNew(let message):
            if chat != nil && chat!.match.id == message.matchId {
                if !chat!.messages.contains(where: { $0.id == message.id }) {
                    chat!.messages.append(message)
                }
                if message.senderId == chat!.match.user.id {
                    chat!.partnerTyping = false
                    let matchId = message.matchId
                    let messageId = message.id
                    Task { try? await self.api.markRead(matchId: matchId, lastMessageId: messageId) }
                }
            } else {
                Task { await self.refreshMatches() }
            }
        case .messageRead(let matchId, let lastMessageId, let readerId):
            if chat != nil && chat!.match.id == matchId && readerId == chat!.match.user.id {
                if let seq = chat!.messages.first(where: { $0.id == lastMessageId })?.seq {
                    chat!.theirLastReadSeq = max(chat!.theirLastReadSeq, seq)
                } else {
                    chat!.theirLastReadSeq = Int.max
                }
            }
        case .matchNew:
            Task { await self.refreshMatches() }
        case .matchClosed(let matchId, _):
            if chat?.match.id == matchId {
                chat = nil
                showToast("This conversation has ended.")
            }
            matches.removeAll { $0.id == matchId }
        case .ping, .unknown:
            break
        }
    }

    public func refreshMatches() async {
        if let fresh = try? await api.matches() {
            matches = fresh
        }
    }

    // MARK: - deck

    public var unreadCount: Int {
        matches.reduce(0) { $0 + $1.unreadCount }
    }

    public func swipeTop(direction: String) {
        guard !deck.isEmpty else { return }
        let candidate = deck.removeFirst()
        Task { [self] in
            do {
                if let match = try await api.swipe(targetId: candidate.id, direction: direction) {
                    newMatch = match
                    await refreshMatches()
                }
            } catch {
                fail(error)
            }
        }
    }

    // MARK: - chat

    public func openChat(_ match: Match) {
        newMatch = nil
        chat = ChatState(match: match, theirLastReadSeq: match.theirLastReadSeq)
        Task { [self] in
            do {
                let page = try await api.messages(matchId: match.id)
                guard chat != nil && chat!.match.id == match.id else { return }
                chat!.messages = page.messages.reversed() // render oldest-first
                if let last = chat!.messages.last {
                    try? await api.markRead(matchId: match.id, lastMessageId: last.id)
                }
                await refreshMatches()
            } catch {
                fail(error)
            }
        }
    }

    public func closeChat() {
        chat = nil
        Task { [self] in await refreshMatches() }
    }

    public func sendChatMessage(_ text: String) {
        guard let current = chat else { return }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let clientId = UUID().uuidString
        let matchId = current.match.id
        let sentViaSocket = socket?.send(type: "message.send", data: [
            "match_id": matchId, "body": body, "client_id": clientId,
        ]) ?? false
        if !sentViaSocket {
            // contract: REST fallback when the socket is down
            Task { [self] in
                do {
                    let msg = try await api.sendMessage(matchId: matchId, body: body, clientId: clientId)
                    if chat != nil && chat!.match.id == matchId
                        && !chat!.messages.contains(where: { $0.id == msg.id }) {
                        chat!.messages.append(msg)
                    }
                } catch let e as MaktubError where e.code == "match_closed" {
                    showToast("This conversation has ended.")
                } catch {
                    fail(error)
                }
            }
        }
        Task { [self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            if chat != nil && chat!.match.id == matchId {
                chat!.partnerTyping = true
            }
        }
    }

    // MARK: - safety

    public func block(userId: String) {
        Task { [self] in
            do {
                try await api.block(userId: userId)
                deck.removeAll { $0.id == userId }
                matches.removeAll { $0.user.id == userId }
                if chat?.match.user.id == userId { chat = nil }
                showToast("Blocked")
            } catch {
                fail(error)
            }
        }
    }

    public func report(userId: String, reason: ReportReason) {
        Task { [self] in
            do {
                try await api.report(userId: userId, reason: reason)
                showToast("Report received — reviewed within 24 hours")
            } catch {
                fail(error)
            }
        }
    }

    public func unmatch(matchId: String) {
        Task { [self] in
            do {
                try await api.unmatch(matchId: matchId)
                // match.closed frame does the cleanup; belt and braces:
                matches.removeAll { $0.id == matchId }
                if chat?.match.id == matchId { chat = nil }
            } catch {
                fail(error)
            }
        }
    }

    // MARK: - profile

    public func saveProfile(bio: String, interests: [String]) async {
        do {
            try await api.patchProfile(["bio": bio, "interests": interests])
            me = try await api.me()
            showToast("Profile saved")
        } catch {
            fail(error)
        }
    }
}

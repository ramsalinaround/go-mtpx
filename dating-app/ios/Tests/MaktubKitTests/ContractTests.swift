import XCTest
@testable import MaktubKit

// Contract conformance against a LIVE server (dating-app/server). Skipped unless
// MAKTUB_BASE_URL is set — CI starts the Go server and points this suite at it.
// Mirrors tests/test-api.js so the Swift client is proven against the same
// behaviors as the web client.

final class ContractTests: XCTestCase {
    private var base: URL? {
        ProcessInfo.processInfo.environment["MAKTUB_BASE_URL"].flatMap(URL.init(string:))
    }

    private func birthdate(age: Int) -> String {
        let cal = Calendar(identifier: .gregorian)
        let date = cal.date(byAdding: .year, value: -age, to: Date())!
        let past = cal.date(byAdding: .day, value: -40, to: date)!
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: past)
    }

    private func expectError(_ code: String, _ op: () async throws -> Void) async {
        do {
            try await op()
            XCTFail("expected \(code), got success")
        } catch let err as MaktubError {
            XCTAssertEqual(err.code, code)
        } catch {
            XCTFail("expected MaktubError \(code), got \(error)")
        }
    }

    func testContractFlowAgainstLiveServer() async throws {
        guard let base else { throw XCTSkip("MAKTUB_BASE_URL not set; start dating-app/server and export it") }
        let api = APIClient(baseURL: base)
        let phone = "+14155550188"

        // envelope + validation
        await expectError("validation_failed") { try await api.requestOTP(phone: "nope") }

        // otp throttle carries retry_after_s
        for _ in 0..<3 { try await api.requestOTP(phone: phone) }
        do {
            try await api.requestOTP(phone: phone)
            XCTFail("expected otp_throttled")
        } catch let err as MaktubError {
            XCTAssertEqual(err.code, "otp_throttled")
            XCTAssertNotNil(err.retryAfterS)
        }

        // verify: wrong code, then right code
        await expectError("invalid_otp") { _ = try await api.verifyOTP(phone: phone, code: "000000") }
        let verified = try await api.verifyOTP(phone: phone, code: "123456")
        XCTAssertEqual(verified.user.onboardingState, "profile_incomplete")

        // underage hard stop, then a valid profile completes onboarding + seeds
        await expectError("underage") {
            try await api.patchProfile(["name": "Sky", "birthdate": self.birthdate(age: 17), "gender": "woman"])
        }
        try await api.patchProfile([
            "name": "Sky", "birthdate": birthdate(age: 28), "gender": "woman", "bio": "Swift conformance bot.",
        ])
        try await api.putPreferences(minAge: 21, maxAge: 40, maxDistanceKm: 25, genders: [])
        let me = try await api.me()
        XCTAssertEqual(me.onboardingState, "complete")
        var matches = try await api.matches()
        XCTAssertEqual(matches.count, 2, "expected seeded matches")
        let jonah = try XCTUnwrap(matches.first { $0.user.id == "jonah" })
        XCTAssertEqual(jonah.unreadCount, 1)

        // idempotent swipes: same client_id retried -> same match, no duplicate
        let cid = UUID().uuidString
        let match1 = try await api.swipe(targetId: "priya", direction: "like", clientId: cid)
        XCTAssertEqual(match1?.user.id, "priya")
        let match2 = try await api.swipe(targetId: "priya", direction: "like", clientId: cid)
        XCTAssertEqual(match2?.id, match1?.id)
        matches = try await api.matches()
        XCTAssertEqual(matches.count, 3)

        // feed excludes swiped/matched, only approved photos serialize
        let feed = try await api.feed()
        let ids = feed.candidates.map(\.id)
        XCTAssertEqual(ids.count, 11)
        XCTAssertFalse(ids.contains("priya"))
        XCTAssertFalse(ids.contains("maya"))
        let theo = try XCTUnwrap(feed.candidates.first { $0.id == "theo" })
        XCTAssertTrue(theo.photos.isEmpty, "pending photo leaked into the feed")

        // pagination: newest-first with a cursor
        let maya = try XCTUnwrap(matches.first { $0.user.id == "maya" })
        let page1 = try await api.messages(matchId: maya.id, limit: 2)
        XCTAssertEqual(page1.messages.count, 2)
        XCTAssertGreaterThan(page1.messages[0].seq, page1.messages[1].seq)
        let cursor = try XCTUnwrap(page1.nextCursor)
        let page2 = try await api.messages(matchId: maya.id, limit: 2, before: cursor)
        XCTAssertEqual(page2.messages.count, 1)
        XCTAssertNil(page2.nextCursor)

        // REST send echoes client_id; read clears unread
        let msgCid = UUID().uuidString
        let sent = try await api.sendMessage(matchId: jonah.id, body: "Cortado, always.", clientId: msgCid)
        XCTAssertEqual(sent.clientId, msgCid)
        try await api.markRead(matchId: jonah.id, lastMessageId: sent.id)
        let matchesAfterRead = try await api.matches()
        let jonahAfter = try XCTUnwrap(matchesAfterRead.first { $0.user.id == "jonah" })
        XCTAssertEqual(jonahAfter.unreadCount, 0)

        // photos: presign -> PUT -> confirm(pending) -> moderation approves
        let presigned = try await api.presignPhoto()
        try await api.uploadPhoto(uploadUrl: presigned.uploadUrl, bytes: Data("sunset".utf8))
        let photo = try await api.confirmPhoto(key: presigned.key)
        XCTAssertEqual(photo.moderationStatus, "pending")
        try await Task.sleep(nanoseconds: 3_200_000_000)
        let meAfter = try await api.me()
        XCTAssertEqual(meAfter.photos.first?.moderationStatus, "approved")

        // unmatch closes; sending into a closed match fails with match_closed
        try await api.unmatch(matchId: jonah.id)
        await expectError("match_closed") {
            _ = try await api.sendMessage(matchId: jonah.id, body: "hello?", clientId: UUID().uuidString)
        }

        // report reason enum validated
        await expectError("validation_failed") {
            _ = try await api.send("POST", "/reports", json: ["user_id": "theo", "reason": "vibes"])
        }
        try await api.report(userId: "theo", reason: .spamOrFake)

        // export accepted; deletion invalidates the session
        try await api.requestExport()
        try await api.deleteAccount()
        do {
            _ = try await api.me()
            XCTFail("deleted account token still valid")
        } catch { /* token_expired or sessionExpired — both acceptable */ }
    }

    func testLiveWebSocketRoundTrip() async throws {
        guard let base else { throw XCTSkip("MAKTUB_BASE_URL not set") }
        let api = APIClient(baseURL: base)
        let phone = "+14155550189"
        try await api.requestOTP(phone: phone)
        _ = try await api.verifyOTP(phone: phone, code: "123456")
        try await api.patchProfile([
            "name": "Wire", "birthdate": birthdate(age: 27), "gender": "man",
        ])
        try await api.putPreferences(minAge: 21, maxAge: 40, maxDistanceKm: 25, genders: [])
        let allMatches = try await api.matches()
        let jonah = try XCTUnwrap(allMatches.first { $0.user.id == "jonah" })

        let socket = SocketClient(baseURL: base)
        let tokens = await api.currentTokens()
        let access = try XCTUnwrap(tokens.access)
        socket.connect(token: access)
        try await Task.sleep(nanoseconds: 500_000_000) // let the socket open

        let sent = socket.send(type: "message.send", data: [
            "match_id": jonah.id, "body": "Over the real socket.", "client_id": UUID().uuidString,
        ])
        XCTAssertTrue(sent, "socket not connected")

        // expect: our echo, the bot reply, and the bot's read receipt
        // (watchdog closes the stream so a silent socket can't hang the test)
        let watchdog = Task {
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            socket.disconnect()
        }
        defer { watchdog.cancel() }
        var sawEcho = false, sawReply = false, sawRead = false
        let deadline = Date().addingTimeInterval(8)
        for await frame in socket.frames {
            switch frame {
            case .messageNew(let m) where m.matchId == jonah.id:
                if m.senderId == "jonah" { sawReply = true } else { sawEcho = true }
            case .messageRead(let matchId, _, let reader) where matchId == jonah.id && reader == "jonah":
                sawRead = true
            default:
                break
            }
            if (sawEcho && sawReply && sawRead) || Date() > deadline { break }
        }
        socket.disconnect()
        XCTAssertTrue(sawEcho, "no message.new echo")
        XCTAssertTrue(sawReply, "no bot reply frame")
        XCTAssertTrue(sawRead, "no read receipt frame")
        await api.logout()
    }
}

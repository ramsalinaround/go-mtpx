import XCTest
@testable import MaktubKit

// Pure decoding tests against captured wire shapes — run anywhere, no server.

final class ModelDecodingTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    func testDecodesCandidate() throws {
        let json = """
        {"id":"priya","name":"Priya","age":27,"gender":"woman","distance_km":3,
         "job":"Ceramicist","bio":"I make bowls.","interests":["Art","Coffee","Yoga"],
         "hue_index":0,"photos":[{"id":"bph_priya_0","urls":{"thumb":"sunset","card":"sunset","full":"sunset"}}]}
        """
        let c = try decoder().decode(Candidate.self, from: Data(json.utf8))
        XCTAssertEqual(c.id, "priya")
        XCTAssertEqual(c.distanceKm, 3)
        XCTAssertEqual(c.photos.first?.urls.card, "sunset")
    }

    func testDecodesMatchWithNullLastMessage() throws {
        let json = """
        {"id":"m_1","created_at":"2026-09-19T00:00:00.000Z",
         "user":{"id":"maya","name":"Maya","age":28,"gender":"woman","distance_km":4,
                 "job":"Photographer","bio":"x","interests":[],"hue_index":4,"photos":[]},
         "last_message":null,"unread_count":0,"their_last_read_seq":0}
        """
        let m = try decoder().decode(Match.self, from: Data(json.utf8))
        XCTAssertNil(m.lastMessage)
        XCTAssertEqual(m.user.id, "maya")
    }

    func testDecodesErrorEnvelope() throws {
        let json = #"{"error":{"code":"otp_throttled","message":"Too many","retry_after_s":30}}"#
        let env = try decoder().decode(APIErrorEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(env.error.code, "otp_throttled")
        XCTAssertEqual(env.error.retryAfterS, 30)
    }

    func testDecodesFrames() throws {
        let msg = FrameDecoder.decode(
            #"{"type":"message.new","data":{"id":"msg_9","seq":9,"match_id":"m_1","sender_id":"maya","body":"hi","created_at":"2026-09-19T00:00:00.000Z","client_id":null}}"#)
        guard case .messageNew(let m)? = msg else { return XCTFail("wrong frame: \(String(describing: msg))") }
        XCTAssertEqual(m.matchId, "m_1")

        let read = FrameDecoder.decode(
            #"{"type":"message.read","data":{"match_id":"m_1","last_message_id":"msg_9","reader_id":"maya"}}"#)
        guard case .messageRead(let matchId, _, let reader)? = read else { return XCTFail("wrong frame") }
        XCTAssertEqual(matchId, "m_1")
        XCTAssertEqual(reader, "maya")

        let closed = FrameDecoder.decode(#"{"type":"match.closed","data":{"match_id":"m_1","reason":"blocked"}}"#)
        guard case .matchClosed(_, let reason)? = closed else { return XCTFail("wrong frame") }
        XCTAssertEqual(reason, "blocked")

        guard case .ping? = FrameDecoder.decode(#"{"type":"ping"}"#) else { return XCTFail("ping") }
    }
}
